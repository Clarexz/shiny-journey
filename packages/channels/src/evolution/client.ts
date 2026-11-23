import { ChannelError, type ChannelErrorCode } from "../types";

/**
 * Cliente HTTP mínimo de Evolution API v2 (plan, 5.3).
 *
 * - Autenticación con el encabezado `apikey`.
 * - Timeout por solicitud (`AbortSignal.timeout`).
 * - Cualquier falla se convierte en `ChannelError` con código. El mensaje nombra la operación
 *   y el código HTTP, nunca el cuerpo (puede traer números o texto) ni la URL con parámetros.
 */

export const DEFAULT_EVOLUTION_TIMEOUT_MS = 8000;

export interface EvolutionClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface EvolutionRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  /** Nombre corto de la operación para los errores (`sendText`, `connect`, ...). */
  op: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Tiempo extra sobre el timeout del cliente (por ejemplo, el `delay` de sendText). */
  extraTimeoutMs?: number;
}

export class EvolutionClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: EvolutionClientOptions) {
    if (!opts.apiKey) throw new ChannelError("invalid_input", "Evolution: falta la API key");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_EVOLUTION_TIMEOUT_MS;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async request<T = unknown>(req: EvolutionRequest): Promise<T> {
    const url = new URL(this.baseUrl + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { apikey: this.apiKey, accept: "application/json" };
    if (req.body !== undefined) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(this.timeoutMs + (req.extraTimeoutMs ?? 0)),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new ChannelError(
        isTimeout ? "timeout" : "network",
        `Evolution ${req.op}: ${isTimeout ? "sin respuesta a tiempo" : "error de red"}`,
        { provider: "evolution", cause: err },
      );
    }

    const text = await res.text().catch(() => "");
    const json = parseJson(text);
    if (!res.ok) throw toChannelError(req.op, res.status, json);
    return json as T;
  }
}

function parseJson(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Mensajes de error de Evolution, aplanados (vienen en `response.message`, `message` o `error`). */
export function errorMessages(body: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || v == null) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, depth + 1));
    else if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["response", "message", "error"]) visit(o[k], depth + 1);
    }
  };
  visit(body, 0);
  return out;
}

/** `true` si el cuerpo es la respuesta de "número sin WhatsApp" (`[{ exists: false, ... }]`). */
export function isNumberNotFound(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const response = (body as { response?: { message?: unknown } }).response;
  const message = response?.message;
  return (
    Array.isArray(message) &&
    message.some((m) => typeof m === "object" && m !== null && (m as Obj).exists === false)
  );
}

type Obj = Record<string, unknown>;

export function toChannelError(op: string, status: number, body: unknown): ChannelError {
  const messages = errorMessages(body).join(" ").toLowerCase();
  let code: ChannelErrorCode;
  let retryable = false;

  if (status === 401 || status === 403) {
    // Evolution responde 403 también cuando el nombre de instancia ya existe.
    code = messages.includes("already in use") ? "invalid_input" : "unauthorized";
  } else if (status === 404) {
    code = "not_found";
  } else if (status === 429) {
    code = "rate_limited";
    retryable = true;
  } else if (isNumberNotFound(body)) {
    code = "number_not_found";
  } else if (messages.includes("connection closed") || messages.includes("not connected")) {
    code = "not_connected";
    retryable = true;
  } else if (status >= 500) {
    code = "provider_error";
    retryable = true;
  } else {
    code = "provider_error";
  }

  return new ChannelError(code, `Evolution ${op}: HTTP ${status}`, {
    provider: "evolution",
    status,
    retryable,
  });
}

/** `true` si el error de `instance/create` significa que la instancia ya existía. */
export function isInstanceAlreadyExists(err: unknown): boolean {
  return err instanceof ChannelError && err.code === "invalid_input" && err.status === 403;
}
