import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createOpenAiClient } from "../src/openai";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

const Schema = z.object({
  sucursal: z.object({ numero: z.number().int().nullable(), pista: z.string().nullable() }),
  fechas: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  turno: z.enum(["matutino", "vespertino", "ambos"]).nullable(),
  confianza: z.number().min(0).max(1),
  nota: z.string().nullable(),
});

// Servidor simulado de la API de OpenAI.
let server: Server;
let url: string;
let reply: { status: number; body: unknown; delayMs?: number } = { status: 200, body: {} };
const requests: Array<{
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
  path?: string;
}> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString()),
        path: req.url,
      });
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  requests.length = 0;
});

const client = (over: Partial<Parameters<typeof createOpenAiClient>[0]> = {}) =>
  createOpenAiClient({
    apiKey: "sk-falsa",
    model: "gpt-6-luna",
    baseUrl: url,
    timeoutMs: 1000,
    ...over,
  });

const call = (c = client()) =>
  c.extractJson({ schema: Schema, name: "extraccion", system: "sistema", user: "usuario" });

describe("createOpenAiClient", () => {
  it("éxito: valida con Zod, mide tokens y costo, y manda los parámetros correctos", async () => {
    reply = { status: 200, body: fixture("success") };
    const r = await call();
    expect(r).toMatchObject({
      ok: true,
      data: { sucursal: { numero: 53 }, fechas: ["2026-11-12", "2026-11-13"], turno: "matutino" },
      usage: {
        used: true,
        model: "gpt-6-luna",
        inputTokens: 1012,
        outputTokens: 64,
        reasoningTokens: 0,
        stopReason: "stop",
      },
    });
    // 1012 * 0.10 + 64 * 0.50 por millón.
    expect(r.usage.costUsd).toBeCloseTo(0.0001332, 10);

    const [req] = requests;
    expect(req?.path).toBe("/v1/chat/completions");
    expect(req?.headers.authorization).toBe("Bearer sk-falsa");
    expect(req?.body).toMatchObject({
      model: "gpt-6-luna",
      reasoning_effort: "none",
      store: false,
      max_completion_tokens: 400,
      messages: [
        { role: "system", content: "sistema" },
        { role: "user", content: "usuario" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "extraccion", strict: true } },
    });
    const schema = (
      req?.body.response_format as { json_schema: { schema: Record<string, unknown> } }
    ).json_schema.schema;
    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ["sucursal", "fechas", "turno", "confianza", "nota"],
    });
    expect(JSON.stringify(schema)).not.toContain("pattern");
    expect(req?.body).not.toHaveProperty("temperature");
  });

  it.each([
    ["refusal", "refusal"],
    ["max-tokens", "max_tokens"],
    ["content-filter", "content_filter"],
    ["invalid-json", "invalid_json"],
    ["schema-mismatch", "schema_mismatch"],
  ] as const)("respuesta grabada %s -> %s", async (name, reason) => {
    reply = { status: 200, body: fixture(name) };
    const r = await call();
    expect(r).toMatchObject({ ok: false, reason, usage: { used: true } });
  });

  it("max_tokens cobra igual los tokens gastados", async () => {
    reply = { status: 200, body: fixture("max-tokens") };
    const r = await call();
    expect(r.usage).toMatchObject({
      outputTokens: 400,
      reasoningTokens: 380,
      stopReason: "length",
    });
    expect(r.usage.costUsd).toBeGreaterThan(0);
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [400, "provider_error"],
  ] as const)("HTTP %i -> %s", async (status, reason) => {
    reply = { status, body: { error: { message: "detalle del proveedor" } } };
    expect(await call()).toMatchObject({ ok: false, reason });
  });

  it("timeout", async () => {
    reply = { status: 200, body: fixture("success"), delayMs: 300 };
    const r = await call(client({ timeoutMs: 50 }));
    expect(r).toMatchObject({ ok: false, reason: "timeout", usage: { stopReason: "timeout" } });
    expect(r.usage.ms).toBeLessThan(250);
  });

  it("error de red", async () => {
    expect(await call(client({ baseUrl: "http://127.0.0.1:1" }))).toMatchObject({
      ok: false,
      reason: "network",
    });
  });

  it("el razonamiento y el límite de salida se pueden configurar", async () => {
    reply = { status: 200, body: fixture("success") };
    await call(client({ reasoningEffort: "low", maxOutputTokens: 800 }));
    expect(requests[0]?.body).toMatchObject({
      reasoning_effort: "low",
      max_completion_tokens: 800,
    });
  });

  it("un modelo sin precio en la tabla no tiene costo", async () => {
    reply = { status: 200, body: fixture("success") };
    const r = await call(client({ model: "modelo-nuevo" }));
    expect(r.ok).toBe(true);
    expect(r.usage.costUsd).toBeUndefined();
  });

  it("exige API key", () => {
    expect(() => createOpenAiClient({ apiKey: "", model: "gpt-6-luna" })).toThrow(/API key/);
  });
});
