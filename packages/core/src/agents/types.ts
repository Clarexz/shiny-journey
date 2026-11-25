/**
 * Tipos del motor de agentes (plan, 4.1, 6.2 y 6.5).
 *
 * El pipeline de un módulo recibe todo lo que necesita a través de `AgentRuntime`, sin
 * importar infraestructura. Las interfaces de servicios (`llm`, `notify`, `rateLimiter`, `db`)
 * son mínimas: las implementaciones llegan en T1.13 (llm), T1.14 (rate limit), T1.17 (notify)
 * y T1.15 (worker), y cada una puede ampliarlas sin romper a los módulos.
 */
import type { ChannelAdapter, InboundMessage } from "@ravyn/channels";
import type { ZodType } from "zod";

// Decisiones

/**
 * Mismos valores que `agent_events.decision`. Son genéricos para cualquier módulo de agente:
 * APARTAR = actuar solo, NOTIFICAR = pedir intervención, DESCARTAR = no hacer nada, OBSERVAR =
 * lo que habría hecho en modo observación.
 */
export const DECISION_KINDS = ["APARTAR", "NOTIFICAR", "DESCARTAR", "OBSERVAR"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const NOTIFY_PRIORITIES = ["high", "normal", "silent"] as const;
export type NotifyPriority = (typeof NOTIFY_PRIORITIES)[number];

export interface Decision<D = unknown> {
  kind: DecisionKind;
  /** Códigos estables (`sucursal_no_aceptada`, `varios_dias`, ...), nunca texto libre. */
  reasons: string[];
  /** Prioridad del aviso al cliente; `null` si no se avisa. */
  notify: NotifyPriority | null;
  /** Datos propios del módulo (sucursal, fecha, plantilla elegida...). */
  data?: D;
}

export type ExtractionSource = "regex" | "llm" | "mixed" | "none";

export interface Extraction<E = unknown> {
  source: ExtractionSource;
  /** Confianza de 0 a 1, si el extractor la calcula. */
  confidence?: number;
  data: E;
  /** Uso del LLM, si lo hubo (va a `agent_events.llm`). */
  llm?: LlmUsage;
}

export interface ActionResult {
  /** `false` si la acción falló; `reasons` explica por qué. */
  ok: boolean;
  /** Decisión final después de actuar (puede bajar de APARTAR a NOTIFICAR, p. ej. por límite). */
  decision: DecisionKind;
  reasons: string[];
  sent?: { providerMessageId: string; to: string; templateId?: string };
  notified?: boolean;
}

// Servicios del runtime

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock & { set(at: Date | string): void } {
  let current = new Date(at);
  return {
    now: () => new Date(current),
    set(next) {
      current = new Date(next);
    },
  };
}

/** Logger estructurado. Nunca recibe texto de mensajes ni números completos. */
export interface AgentLogger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export const silentLogger: AgentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Cronómetro por etapa (6.5). Los nombres terminan en `_ms` en `agent_events.latency`. */
export interface Timing {
  start(stage: string): void;
  end(stage: string): number;
  /** Mide una función async completa. */
  measure<T>(stage: string, fn: () => Promise<T>): Promise<T>;
  /** Milisegundos desde el inicio del cronómetro (normalmente `receivedAt` del webhook). */
  elapsed(): number;
  snapshot(): Record<string, number>;
}

export interface LlmUsage {
  used: boolean;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** Incluidos en `outputTokens`. */
  reasoningTokens?: number;
  cachedInputTokens?: number;
  stopReason?: string | null;
  ms?: number;
}

/** Motivos estables de una extracción fallida (van a `agent_events.llm.stop_reason`). */
export const LLM_FAILURE_REASONS = [
  "timeout",
  "network",
  "unauthorized",
  "rate_limited",
  "provider_error",
  "refusal",
  "max_tokens",
  "content_filter",
  "invalid_json",
  "schema_mismatch",
  "budget_exhausted",
] as const;
export type LlmFailureReason = (typeof LLM_FAILURE_REASONS)[number];

export type LlmResult<T> =
  { ok: true; data: T; usage: LlmUsage } | { ok: false; reason: LlmFailureReason; usage: LlmUsage };

/** Extracción estructurada con LLM (implementación en `packages/llm`). Nunca lanza. */
export interface LlmClient {
  extractJson<T>(input: {
    schema: ZodType<T>;
    /** Nombre del esquema para el proveedor (`[a-zA-Z0-9_-]`). */
    name?: string;
    system: string;
    user: string;
    timeoutMs?: number;
  }): Promise<LlmResult<T>>;
}

export interface NotificationRequest {
  kind: string;
  priority: NotifyPriority;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  /** Acción de un toque desde la notificación ("Tomarlo"). */
  action?: { name: string; expiresInMin: number };
}

/** Encola avisos al cliente (T1.17). */
export interface Notifier {
  enqueue(tenantId: string, notification: NotificationRequest): Promise<void>;
}

export type RateLimitResult =
  { ok: true } | { ok: false; reason: "por_hora" | "por_dia" | "mismo_contacto" };

/** Límite de envíos por canal (T1.14, 6.4). */
export interface RateLimiter {
  /** Verifica y, si hay cupo, consume. */
  tryConsume(input: { channelId: string; contact: string }): Promise<RateLimitResult>;
}

export interface AgentConfigRef<C> {
  id: string;
  moduleKey: string;
  channelId: string;
  status: "active" | "observe" | "paused";
  config: C;
  configVersion: number;
}

/**
 * Lo que el pipeline recibe del motor. `db` es el acceso tenant-scoped que arma el worker
 * (`tenantTable`); cada módulo declara el tipo que espera con el segundo parámetro.
 */
export interface AgentRuntime<C, Db = unknown> {
  tenantId: string;
  tenantTimezone: string;
  agentConfig: AgentConfigRef<C>;
  clock: Clock;
  db: Db;
  channel: ChannelAdapter;
  llm: LlmClient | null;
  notify: Notifier;
  rateLimiter: RateLimiter;
  logger: AgentLogger;
  timing: Timing;
}

export interface AgentPipeline<C, Db = unknown> {
  /** Síncrono y barato (regex). `false`: fin, sin persistir el texto. */
  prefilter(msg: InboundMessage, config: C): boolean;
  extract(msg: InboundMessage, rt: AgentRuntime<C, Db>): Promise<Extraction>;
  decide(ex: Extraction, msg: InboundMessage, rt: AgentRuntime<C, Db>): Promise<Decision>;
  act(decision: Decision, msg: InboundMessage, rt: AgentRuntime<C, Db>): Promise<ActionResult>;
}
