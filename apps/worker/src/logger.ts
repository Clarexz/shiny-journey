import pino, { type DestinationStream, type Logger } from "pino";

/**
 * Campos con contenido de mensajes o datos personales. Nunca se registran (plan, 11.2).
 * Se listan con prefijos explícitos en lugar de comodines (`*.message`) para no borrar
 * `err.message`, que sí hace falta para depurar.
 */
const SENSITIVE_FIELDS = ["text", "message", "body", "pushName", "participant", "caption"];
const PREFIXES = ["", "data.", "payload.", "msg.", "inbound.", "data.message.", "data.key."];

export const REDACT_PATHS = PREFIXES.flatMap((prefix) =>
  SENSITIVE_FIELDS.map((field) => `${prefix}${field}`),
);

export const REDACTED = "[redactado]";

export interface LoggerOptions {
  level?: string;
  service?: string;
  destination?: DestinationStream;
}

export function createLogger({
  level = "info",
  service = "worker",
  destination,
}: LoggerOptions = {}): Logger {
  return pino(
    {
      level,
      base: { service },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      formatters: { level: (label) => ({ level: label }) },
      serializers: {
        err: pino.stdSerializers.err,
        req: (req: { method?: string; url?: string; id?: unknown }) => ({
          id: req.id,
          method: req.method,
          url: req.url ? sanitizeUrl(req.url) : undefined,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
    },
    destination,
  );
}

/**
 * Quita secretos de la URL antes de registrarla: el token del webhook va en la ruta
 * (`/webhooks/<proveedor>/<canal>/<token>`) y no debe quedar en los logs.
 */
export function sanitizeUrl(url: string): string {
  const [path = "", query] = url.split("?", 2);
  const clean = path.replace(/^(\/webhooks\/[^/]+\/[^/]+\/)[^/]+/, `$1${REDACTED}`);
  return query === undefined ? clean : `${clean}?${REDACTED}`;
}
