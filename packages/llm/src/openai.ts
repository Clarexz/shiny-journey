import type { LlmClient, LlmFailureReason, LlmResult, LlmUsage } from "@ravyn/core";
import type { ZodType } from "zod";
import { toStrictJsonSchema } from "./json-schema";
import { estimateCostUsd, type ModelPrice } from "./pricing";

/**
 * Cliente de OpenAI para extracción estructurada (Chat Completions con Structured Outputs).
 *
 * - `response_format: json_schema` en modo estricto; la respuesta se valida de nuevo con Zod.
 * - `reasoning_effort`: por defecto "none". En gpt-6-luna el valor por defecto de la API es
 *   "medium", que dispara la latencia: hay que mandarlo siempre.
 * - `store: false`: OpenAI no guarda la conversación (el texto puede traer datos personales).
 * - Timeout duro y sin reintentos: si no responde a tiempo, el caso pasa a NOTIFICAR (7.6).
 * - Nunca lanza: toda falla vuelve como `{ ok: false, reason }`. Los motivos nunca incluyen el
 *   texto del mensaje ni el cuerpo de la respuesta.
 */

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAiClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  reasoningEffort?: ReasoningEffort;
  /** Incluye el razonamiento, si lo hay. */
  maxOutputTokens?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  prices?: Readonly<Record<string, ModelPrice>>;
  now?: () => number;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export function createOpenAiClient(opts: OpenAiClientOptions): LlmClient {
  if (!opts.apiKey) throw new Error("createOpenAiClient: falta la API key");
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? (() => performance.now());

  return {
    async extractJson<T>(input: {
      schema: ZodType<T>;
      name?: string;
      system: string;
      user: string;
      timeoutMs?: number;
    }): Promise<LlmResult<T>> {
      const t0 = now();
      const usage: LlmUsage = { used: true, model: opts.model };
      const fail = (reason: LlmFailureReason): LlmResult<T> => ({
        ok: false,
        reason,
        usage: { ...usage, stopReason: usage.stopReason ?? reason, ms: Math.round(now() - t0) },
      });

      const body = {
        model: opts.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: input.name ?? "extraccion",
            strict: true,
            schema: toStrictJsonSchema(input.schema),
          },
        },
        reasoning_effort: opts.reasoningEffort ?? "none",
        max_completion_tokens: opts.maxOutputTokens ?? 400,
        store: false,
      };

      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(input.timeoutMs ?? opts.timeoutMs ?? 2000),
        });
      } catch (err) {
        const timeout =
          err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        return fail(timeout ? "timeout" : "network");
      }

      let json: ChatCompletion;
      try {
        json = (await res.json()) as ChatCompletion;
      } catch (err) {
        const timeout =
          err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        return fail(timeout ? "timeout" : res.ok ? "invalid_json" : "provider_error");
      }

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return fail("unauthorized");
        if (res.status === 429) return fail("rate_limited");
        return fail("provider_error");
      }

      const u = json.usage ?? {};
      usage.inputTokens = u.prompt_tokens ?? 0;
      usage.cachedInputTokens = u.prompt_tokens_details?.cached_tokens ?? 0;
      usage.outputTokens = u.completion_tokens ?? 0;
      usage.reasoningTokens = u.completion_tokens_details?.reasoning_tokens ?? 0;
      usage.costUsd =
        estimateCostUsd(
          opts.model,
          {
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
          },
          opts.prices,
        ) ?? undefined;

      const choice = json.choices?.[0];
      usage.stopReason = choice?.finish_reason ?? null;
      if (choice?.message?.refusal) return fail("refusal");
      if (choice?.finish_reason === "length") return fail("max_tokens");
      if (choice?.finish_reason === "content_filter") return fail("content_filter");

      const content = choice?.message?.content;
      if (typeof content !== "string") return fail("invalid_json");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return fail("invalid_json");
      }
      const valid = input.schema.safeParse(parsed);
      if (!valid.success) return fail("schema_mismatch");
      return { ok: true, data: valid.data, usage: { ...usage, ms: Math.round(now() - t0) } };
    },
  };
}
