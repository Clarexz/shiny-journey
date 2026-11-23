/**
 * Motor de reglas del Apartador (plan, 7.7). Se evalúan en orden y la primera que decide gana.
 * Cada regla devuelve un motivo estable.
 *
 * La disponibilidad, los claims y el cupo de envíos llegan por interfaces, para probar sin
 * base de datos ni Redis. Las reglas no consumen cupo de envíos: solo consultan (la regla 16
 * mira; `act` consume).
 */
import type { Decision, DecisionKind, NotifyPriority, RateLimitResult } from "@ravyn/core";
import type { ApartadorConfig } from "../config";
import type { BranchMatch } from "./branch";
import { addDays, fmt } from "./dates";
import type { TurnoExtraction } from "./extract";

export type RuleReason =
  | "agente_pausado"
  | "sucursal_no_aceptada"
  | "turno_no_permitido"
  | "baja_confianza"
  | "varias_sucursales"
  | "fecha_pasada"
  | "varios_dias"
  | "ambos_turnos"
  | "turno_desconocido"
  | "sucursal_desconocida"
  | "fecha_lejana"
  | "dia_no_disponible"
  | "ya_tiene_turno"
  | "duplicado"
  | "remitente_sin_numero"
  | "limite_envios"
  | "modo_observacion"
  | "sucursal_ambigua"
  | "cumple";

/** Número de regla de 7.7 de cada motivo (para el historial y las pruebas). */
export const RULE_NUMBER: Record<RuleReason, number> = {
  agente_pausado: 1,
  sucursal_no_aceptada: 2,
  turno_no_permitido: 3,
  baja_confianza: 4,
  varias_sucursales: 5,
  fecha_pasada: 6,
  varios_dias: 7,
  ambos_turnos: 8,
  turno_desconocido: 9,
  sucursal_desconocida: 10,
  fecha_lejana: 11,
  dia_no_disponible: 12,
  ya_tiene_turno: 13,
  duplicado: 14,
  remitente_sin_numero: 15,
  limite_envios: 16,
  modo_observacion: 17,
  sucursal_ambigua: 18,
  cumple: 19,
};

export interface Publisher {
  jid: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
}

/** Excepciones por fecha (`mod_turnos_availability`, en caché de 30 s). */
export interface AvailabilitySource {
  exceptions(dates: string[]): Promise<ReadonlyMap<string, boolean>>;
}

/** Turnos ya apartados (`mod_turnos_claims`). */
export interface ClaimsSource {
  /** Fechas (de las dadas) con un claim activo (`dm_sent` o `confirmed`). */
  activeOn(dates: string[]): Promise<ReadonlySet<string>>;
  /** Si ya se le escribió a este publicador por ese día y turno (cualquier estado). */
  contacted(publisherJid: string, date: string, shift: string): Promise<boolean>;
}

/** Consulta de cupo de envíos, sin consumir (6.4). */
export interface SendBudget {
  check(contact: string): Promise<RateLimitResult>;
}

export interface RuleContext {
  config: ApartadorConfig;
  status: "active" | "observe" | "paused";
  /** Fecha local de hoy (`AAAA-MM-DD`) en la zona del tenant. */
  today: string;
  publisher: Publisher;
  /** Si el canal puede escribirle a un JID `@lid` (T1.6: sí en Evolution v2.3.7). */
  canSendToLid: boolean;
  availability: AvailabilitySource;
  claims: ClaimsSource;
  sendBudget: SendBudget;
}

/** Datos de la decisión para `act`, el historial y los avisos. */
export interface TurnoDecisionData {
  rule: number;
  branch: BranchMatch | null;
  date: string | null;
  dates: string[];
  shift: TurnoExtraction["shift"];
  /** Plantilla a usar si se aparta. */
  template: "interest" | "interestAmbiguous" | null;
  /** Referencia que se pregunta en el DM ambiguo ("¿es la de Cumbres?"). */
  askLabel: string | null;
  /** Destino del DM: teléfono si se conoce; si no, el JID `@lid`. */
  sendTo: { phone: string } | { jid: string } | null;
}

export type TurnoDecision = Decision<TurnoDecisionData> & { reasons: [RuleReason] };

// Prioridad del aviso por regla (columna "Push" de 7.7).
type Push = "alta" | "normal" | "silencio" | "no";

function decision(
  kind: DecisionKind,
  reason: RuleReason,
  push: Push,
  ctx: Pick<RuleContext, "config">,
  data: Omit<TurnoDecisionData, "rule">,
): TurnoDecision {
  const notify: NotifyPriority | null =
    push === "alta"
      ? "high"
      : push === "normal"
        ? "normal"
        : push === "silencio" && ctx.config.notifyDiscarded
          ? "silent"
          : null;
  return { kind, reasons: [reason], notify, data: { rule: RULE_NUMBER[reason], ...data } };
}

const isoWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function sendTarget(p: Publisher, canSendToLid: boolean): TurnoDecisionData["sendTo"] {
  if (p.phone) return { phone: p.phone };
  if (p.lid && canSendToLid) return { jid: `${p.lid}@lid` };
  return null;
}

/**
 * Reglas 1 a 3: los descartes duros que se deciden con lo que dio el regex, antes de llamar al
 * LLM (evitan la llamada y avisos que serían ruido). `null` si ninguna aplica.
 */
export function earlyDecision(
  ex: TurnoExtraction,
  ctx: Pick<RuleContext, "config" | "status">,
): TurnoDecision | null {
  const base = {
    branch: ex.branches[0] ?? null,
    date: ex.dates[0] ?? null,
    dates: ex.dates,
    shift: ex.shift,
    template: null,
    askLabel: null,
    sendTo: null,
  };

  // 1. Agente en pausa.
  if (ctx.status === "paused") return decision("DESCARTAR", "agente_pausado", "no", ctx, base);

  // 2. Sucursal no aceptada (o ambigua sin candidatos aceptados). Con varias sucursales solo
  //    se descarta si todas son no aceptadas; si no, sigue a la regla 5.
  if (ex.branches.length > 0 && ex.branches.every((b) => b.acceptance === "no_aceptada")) {
    return decision("DESCARTAR", "sucursal_no_aceptada", "silencio", ctx, base);
  }

  // 3. Turno no permitido ("ambos" se trata en la regla 8).
  if (
    (ex.shift === "matutino" || ex.shift === "vespertino") &&
    !ctx.config.shifts.allowed.includes(ex.shift)
  ) {
    return decision("DESCARTAR", "turno_no_permitido", "silencio", ctx, base);
  }
  return null;
}

export async function evaluateRules(ex: TurnoExtraction, ctx: RuleContext): Promise<TurnoDecision> {
  const early = earlyDecision(ex, ctx);
  if (early) return early;

  const { config } = ctx;
  const branch = ex.branches[0] ?? null;
  const date = ex.dates[0] ?? null;
  const base = {
    branch,
    date,
    dates: ex.dates,
    shift: ex.shift,
    template: null,
    askLabel: null,
    sendTo: null,
  } satisfies Omit<TurnoDecisionData, "rule">;

  // 4. Fallo de extracción o confianza baja (también sin fecha o sin sucursal).
  if (ex.failed || ex.confidence < config.minConfidence || !branch || !date) {
    return decision("NOTIFICAR", "baja_confianza", "alta", ctx, base);
  }

  // 5. Varias sucursales.
  if (ex.branches.length > 1) return decision("NOTIFICAR", "varias_sucursales", "alta", ctx, base);

  // 6. Alguna fecha en el pasado.
  if (ex.dates.some((d) => d < ctx.today))
    return decision("DESCARTAR", "fecha_pasada", "no", ctx, base);

  // 7. Más de una fecha.
  if (ex.dates.length > 1) return decision("NOTIFICAR", "varios_dias", "alta", ctx, base);

  // 8. Ambos turnos.
  if (ex.shift === "ambos") {
    return config.shifts.bothShiftsRequest === "notify"
      ? decision("NOTIFICAR", "ambos_turnos", "alta", ctx, base)
      : decision("DESCARTAR", "ambos_turnos", "silencio", ctx, base);
  }

  // 9. Turno desconocido.
  if (ex.shift === null) return decision("NOTIFICAR", "turno_desconocido", "alta", ctx, base);

  // 10. Sucursal que no está en el catálogo.
  if (branch.acceptance === "desconocida")
    return decision("NOTIFICAR", "sucursal_desconocida", "normal", ctx, base);

  // 11. Fecha más allá de maxDaysAhead.
  const today = ctx.today;
  const limit = fmt(addDays(parseYmd(today), config.availability.maxDaysAhead));
  if (date > limit) return decision("NOTIFICAR", "fecha_lejana", "normal", ctx, base);

  // 12. Día no disponible (regla semanal o excepción; la excepción manda).
  const exceptions = await ctx.availability.exceptions([date]);
  const available = exceptions.get(date) ?? config.availability.weekdays.includes(isoWeekday(date));
  if (!available) return decision("DESCARTAR", "dia_no_disponible", "silencio", ctx, base);

  // 13. Ya tiene un turno apartado ese día.
  if ((await ctx.claims.activeOn([date])).has(date)) {
    return decision("DESCARTAR", "ya_tiene_turno", "silencio", ctx, base);
  }

  // 14. Ya se le escribió a ese publicador por ese turno.
  if (await ctx.claims.contacted(ctx.publisher.jid, date, ex.shift)) {
    return decision("DESCARTAR", "duplicado", "no", ctx, base);
  }

  // 15. Remitente sin número y sin forma de escribirle.
  const sendTo = sendTarget(ctx.publisher, ctx.canSendToLid);
  if (!sendTo) return decision("NOTIFICAR", "remitente_sin_numero", "alta", ctx, base);
  const withTarget = { ...base, sendTo };

  // 16. Límite de envíos (solo se consulta).
  const contact = "phone" in sendTo ? sendTo.phone : sendTo.jid;
  if (!(await ctx.sendBudget.check(contact)).ok) {
    return decision("NOTIFICAR", "limite_envios", "alta", ctx, withTarget);
  }

  // 17. Modo observación.
  const ambiguous = branch.acceptance === "mixta";
  const template = ambiguous ? "interestAmbiguous" : "interest";
  const askLabel = ambiguous ? (branch.accepted?.label ?? null) : null;
  if (ctx.status === "observe") {
    return decision("OBSERVAR", "modo_observacion", "normal", ctx, {
      ...withTarget,
      template,
      askLabel,
    });
  }

  // 18. Sucursal ambigua mixta: según ambiguityPolicy.
  if (ambiguous) {
    switch (config.ambiguityPolicy) {
      case "notify":
        return decision("NOTIFICAR", "sucursal_ambigua", "alta", ctx, withTarget);
      case "claim":
        return decision("APARTAR", "sucursal_ambigua", "alta", ctx, {
          ...withTarget,
          template: "interest",
        });
      case "ask_in_dm":
        return decision("APARTAR", "sucursal_ambigua", "alta", ctx, {
          ...withTarget,
          template,
          askLabel,
        });
    }
  }

  // 19. Todo cumple.
  return decision("APARTAR", "cumple", "alta", ctx, { ...withTarget, template: "interest" });
}

function parseYmd(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}
