/**
 * Parser de fechas determinista, el camino rápido (plan, 7.4).
 *
 * Trabaja con fechas de calendario (`AAAA-MM-DD`). "Hoy" sale de `now` en la zona del tenant
 * con `Intl` (la base de datos de zonas del runtime), nunca con un desplazamiento fijo:
 * Reynosa y Matamoros siguen el horario de verano de EE. UU. Las sumas de días se hacen en
 * UTC sobre fechas sin hora, así que el cambio de horario no las afecta.
 */

export const DEFAULT_TIMEZONE = "America/Matamoros";

export interface DateParse {
  /** Fechas pedidas, ordenadas y sin repetir. */
  dates: string[];
  /** 1.0 si hay exactamente una expresión de fecha y es consistente. */
  confidence: number;
  /** `true` si conviene pedirle al LLM que lo resuelva (7.4 y 7.6). */
  requiresLlm: boolean;
  /** Por qué bajó la confianza: códigos estables, sin texto del mensaje. */
  issues: DateIssue[];
  source: "regex";
}

export type DateIssue =
  | "sin_fecha"
  | "varias_fechas"
  | "incoherente"
  | "fecha_invalida"
  | "expresion_no_reconocida"
  | "manana_ambigua";

// Fechas de calendario

const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
] as const;

const MONTHS: Record<string, number> = {
  enero: 1,
  ene: 1,
  febrero: 2,
  feb: 2,
  marzo: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  julio: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  oct: 10,
  noviembre: 11,
  nov: 11,
  diciembre: 12,
  dic: 12,
};

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const fmt = ({ y, m, d }: Ymd) => `${y}-${pad(m)}-${pad(d)}`;

function toUtc({ y, m, d }: Ymd): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): Ymd {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

export function addDays(day: Ymd, n: number): Ymd {
  const t = toUtc(day);
  t.setUTCDate(t.getUTCDate() + n);
  return fromUtc(t);
}

const weekday = (day: Ymd) => toUtc(day).getUTCDay();
const diffDays = (a: Ymd, b: Ymd) =>
  Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86_400_000);

function isValid({ y, m, d }: Ymd): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Fecha local de `now` en la zona indicada. */
export function localDate(now: Date, timeZone = DEFAULT_TIMEZONE): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

// Expresiones

const WD = "lunes|martes|miercoles|jueves|viernes|sabado|domingo";
const MO = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** "mañana" como turno: se retira antes de buscar "mañana" como fecha. */
const RE_MANANA_TURNO = /\b(turno\s+de\s+(la\s+)?|(de|en|por)\s+la\s+)manana\b/g;

const RE_EXPR = new RegExp(
  String.raw`\b(?:(?<hoy>el\s+dia\s+de\s+hoy|hoy)|(?<pasado>pasado\s+manana)|` +
    String.raw`(?<wd>(?:(?<mod>este|esta|el|proximo|prox)\s+)?(?<wdname>${WD}))|(?<manana>manana))` +
    String.raw`(?:\s*,?\s*(?:el\s+|dia\s+)?(?<d1>\d{1,2})(?!\d)(?:\s+(?:de\s+)?(?<m1>${MO})\b)?)?` +
    String.raw`|\b(?:el\s+|dia\s+)?(?<d2>\d{1,2})\s+(?:de\s+)?(?<m2>${MO})\b`,
  "g",
);

/** Expresiones que el regex no resuelve: van al LLM. */
const RE_UNSUPPORTED = new RegExp(
  String.raw`\b(fin\s+de\s+semana|la\s+otra\s+semana|semana\s+que\s+entra|proxima\s+semana|` +
    String.raw`toda\s+la\s+semana|esta\s+semana|del?\s+\d{1,2}\s+al\s+\d{1,2}|de\s+(${WD})\s+a\s+(${WD}))\b`,
);

/**
 * Listas de días con el mes al final: "14 y 15 de noviembre", "14, 15 y 16 de nov". El regex
 * principal solo vería el último día; aquí salen todos.
 */
const RE_DAY_LIST = new RegExp(
  String.raw`\b((?:\d{1,2}\s*(?:,|y)\s*)+)(\d{1,2})\s+(?:de\s+)?(${MO})\b`,
  "g",
);

/** Formas de "mañana" que el plan acepta como fecha sin dudas (7.4). */
function mananaIsExplicit(text: string, index: number, end: number): boolean {
  const before = text.slice(0, index);
  const after = text.slice(end);
  return (
    /\b(para|el\s+dia\s+de)\s+$/.test(before) ||
    new RegExp(String.raw`^\s*,?\s*(${WD})\b`).test(after) ||
    /^\s*,?\s*turno\b/.test(after)
  );
}

/**
 * Año de un `<dd> de <mes>` sin año: el actual; si la fecha ya pasó hace más de 7 días, el
 * siguiente ("2 de enero" dicho el 30 de diciembre).
 */
function withYear(d: number, m: number, today: Ymd): Ymd {
  const thisYear = { y: today.y, m, d };
  if (isValid(thisYear) && diffDays(thisYear, today) < -7) return { y: today.y + 1, m, d };
  return thisYear;
}

/** Siguiente fecha con día del mes `d`, a partir de `from` (incluido). */
function nextDayOfMonth(d: number, from: Ymd): Ymd | null {
  for (let i = 0; i < 2; i++) {
    const m0 = from.m - 1 + i;
    const candidate = { y: from.y + Math.floor(m0 / 12), m: (m0 % 12) + 1, d };
    if (isValid(candidate) && diffDays(candidate, from) >= 0) return candidate;
  }
  return null;
}

/**
 * Extrae las fechas del texto normalizado (`normalize`). `now` es el `waTimestamp` del
 * mensaje; la fecha local se calcula en `timeZone`.
 */
export function parseDates(normalized: string, now: Date, timeZone = DEFAULT_TIMEZONE): DateParse {
  const today = localDate(now, timeZone);
  const text = normalized.replace(RE_MANANA_TURNO, (m) => " ".repeat(m.length));
  const issues = new Set<DateIssue>();
  const found: Ymd[] = [];

  for (const match of text.matchAll(RE_EXPR)) {
    const g = match.groups ?? {};
    const day = g.d1 ?? g.d2;
    const monthName = g.m1 ?? g.m2;
    const explicit: Ymd | null =
      day && monthName ? withYear(Number(day), MONTHS[monthName]!, today) : null;
    if (explicit && !isValid(explicit)) {
      issues.add("fecha_invalida");
      continue;
    }

    // Fecha que da la palabra (hoy, mañana, día de la semana), si la hay.
    let anchor: Ymd | null = null;
    let anchorWeekday: number | null = null;
    if (g.hoy) anchor = today;
    else if (g.pasado) anchor = addDays(today, 2);
    else if (g.manana) {
      anchor = addDays(today, 1);
      if (!mananaIsExplicit(text, match.index, match.index + g.manana.length)) {
        issues.add("manana_ambigua");
      }
    } else if (g.wdname) {
      anchorWeekday = WEEKDAYS.indexOf(g.wdname as (typeof WEEKDAYS)[number]);
      const proximo = g.mod === "proximo" || g.mod === "prox";
      let delta = (anchorWeekday - weekday(today) + 7) % 7;
      if (proximo && delta === 0) delta = 7;
      anchor = addDays(today, delta);
    }

    if (!anchor) {
      // "15 de noviembre" solo.
      if (explicit) found.push(explicit);
      continue;
    }
    if (!day) {
      found.push(anchor);
      continue;
    }

    // Combinación: "hoy 9 noviembre", "domingo 15", "hoy 9". Debe ser consistente; si no, se
    // usa el número (como pide el prompt del LLM) con confianza baja.
    const numbered =
      explicit ?? (anchorWeekday === null ? null : nextDayOfMonth(Number(day), today));
    let consistent: boolean;
    if (anchorWeekday !== null) {
      consistent = numbered !== null && weekday(numbered) === anchorWeekday;
    } else if (numbered) {
      consistent = fmt(numbered) === fmt(anchor);
    } else {
      // "hoy 9" sin mes: el número debe ser el día de hoy (o de la palabra).
      consistent = Number(day) === anchor.d;
    }
    if (!consistent) issues.add("incoherente");
    // Con número, la fecha la da el número ("el jueves 19" dicho el jueves 12 es el 19, no hoy).
    found.push(numbered ?? anchor);
  }

  for (const match of text.matchAll(RE_DAY_LIST)) {
    const month = MONTHS[match[3]!]!;
    for (const n of match[1]!.match(/\d{1,2}/g) ?? []) {
      const day = withYear(Number(n), month, today);
      if (isValid(day)) found.push(day);
      else issues.add("fecha_invalida");
    }
  }

  if (RE_UNSUPPORTED.test(text)) issues.add("expresion_no_reconocida");

  const dates = [...new Set(found.map(fmt))].sort();
  if (dates.length === 0) issues.add("sin_fecha");
  if (dates.length > 1) issues.add("varias_fechas");

  let confidence = dates.length === 0 ? 0 : 1;
  if (issues.has("manana_ambigua")) confidence = Math.min(confidence, 0.85);
  if (issues.has("varias_fechas")) confidence = Math.min(confidence, 0.9);
  if (
    issues.has("incoherente") ||
    issues.has("fecha_invalida") ||
    issues.has("expresion_no_reconocida")
  ) {
    confidence = Math.min(confidence, 0.3);
  }

  return {
    dates,
    confidence,
    requiresLlm:
      issues.has("sin_fecha") ||
      issues.has("varias_fechas") ||
      issues.has("incoherente") ||
      issues.has("fecha_invalida") ||
      issues.has("expresion_no_reconocida"),
    issues: [...issues],
    source: "regex",
  };
}
