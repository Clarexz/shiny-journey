/**
 * Prompt del extractor con LLM (plan, 7.6). El sistema es fijo; la fecha y los ejemplos van en
 * el mensaje de usuario. No menciona proveedor ni modelo: es el mismo para cualquiera.
 * Al cambiarlo, subir PROMPT_VERSION y correr `npm run eval:extractor`.
 */
import { z } from "zod";

export const PROMPT_VERSION = 1;

export const LlmExtractionSchema = z.object({
  sucursal: z.object({
    numero: z.number().int().nullable(),
    /** Colonia o calle mencionada, tal cual. */
    pista: z.string().nullable(),
  }),
  fechas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  turno: z.enum(["matutino", "vespertino", "ambos"]).nullable(),
  confianza: z.number().min(0).max(1),
  /** Por qué la confianza es baja. */
  nota: z.string().nullable(),
});

export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;

export const SYSTEM_PROMPT = `Eres un extractor de datos. Recibes un mensaje publicado en un grupo de WhatsApp
de médicos de farmacias de Reynosa, Tamaulipas, donde alguien pide que le cubran
un turno. Devuelve solo los datos pedidos según el esquema.

Reglas:
- "fechas": todas las fechas de turno que se piden, en formato AAAA-MM-DD, resueltas
  respecto a la fecha actual que se te da. "hoy" es la fecha actual. Un día de la
  semana sin más contexto ("este jueves", "el viernes") es su siguiente ocurrencia,
  incluido hoy si coincide. "jueves y viernes" son dos fechas. Si el mensaje da día
  de la semana y número ("domingo 15 noviembre") y no coinciden, usa el número y baja
  la confianza.
- "mañana" puede ser una fecha ("para mañana") o un turno ("de la mañana",
  "en la mañana", "turno de la mañana" = matutino). Distingue por contexto.
- "turno": "matutino", "vespertino" o "ambos" ("ambos turnos", "todo el día",
  "matutino y vespertino"). null si no se menciona.
- "sucursal.numero": el número que sigue a "Reynosa". "sucursal.pista": colonia,
  calle o referencia que acompañe a la sucursal (por ejemplo "cumbres", "pirámides",
  "juárez"), copiada del texto; null si no hay.
- Si se mencionan varias sucursales, usa la primera y baja la confianza a 0.4 o menos.
- "confianza": 0.9 o más solo si fechas, turno y sucursal son inequívocos. Baja la
  confianza si algo es ambiguo, contradictorio o falta; explica en "nota".
- Ignora saludos, motivos personales y emojis. No inventes datos.`;

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "lunes 2026-11-09 07:40" en la zona del tenant. */
export function formatNow(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${weekday} ${date} ${get("hour")}:${get("minute")}`;
}

const EXAMPLES = `Ejemplos:
Actual: lunes 2026-11-09 07:40
Mensaje: "Buenos días busco cobertura para hoy 9 noviembre matutino en cumbres Reynosa 3"
Salida: {"sucursal":{"numero":3,"pista":"cumbres"},"fechas":["2026-11-09"],"turno":"matutino","confianza":0.97,"nota":null}

Actual: martes 2026-11-10 15:12
Mensaje: "Busco cobertura para este jueves y viernes turno matutino reynosa 53 por motivos de salud"
Salida: {"sucursal":{"numero":53,"pista":null},"fechas":["2026-11-12","2026-11-13"],"turno":"matutino","confianza":0.95,"nota":null}

Actual: miércoles 2026-11-11 18:30
Mensaje: "Buenas tardes busco cobertura domingo 15 noviembre, Reynosa 52 pirámides ambos turnos"
Salida: {"sucursal":{"numero":52,"pista":"pirámides"},"fechas":["2026-11-15"],"turno":"ambos","confianza":0.96,"nota":null}

Actual: jueves 2026-11-12 13:05
Mensaje: "Buenas tardes solicito cobertura el día de hoy para reynosa 13, en turno vespertino en la juarez 2"
Salida: {"sucursal":{"numero":13,"pista":"juarez 2"},"fechas":["2026-11-12"],"turno":"vespertino","confianza":0.7,"nota":"menciona 'juarez 2', podría ser otra referencia de sucursal"}

Actual: viernes 2026-11-13 06:50
Mensaje: "Necesito cobertura mañana en la mañana reynosa 15"
Salida: {"sucursal":{"numero":15,"pista":null},"fechas":["2026-11-14"],"turno":"matutino","confianza":0.9,"nota":null}`;

/** Mensaje de usuario: fecha actual, ejemplos y el texto original escapado (sin normalizar). */
export function buildUserPrompt(text: string, now: Date, timeZone: string): string {
  return `Fecha y hora actual: ${formatNow(now, timeZone)} (${timeZone})

${EXAMPLES}

Mensaje a procesar:
${JSON.stringify(text)}`;
}
