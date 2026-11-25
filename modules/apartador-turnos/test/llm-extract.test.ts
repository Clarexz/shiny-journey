import { readFileSync } from "node:fs";
import type { LlmClient, LlmResult } from "@ravyn/core";
import { describe, expect, it, vi } from "vitest";
import { REAL_MESSAGES } from "../fixtures/real-messages";
import { analyze, type AnalyzeContext } from "../src/server/analyze";
import { buildUserPrompt, formatNow, SYSTEM_PROMPT } from "../src/server/prompt";
import { CATALOG, TZ, ruleContext } from "./helpers";

/** Cliente que reproduce una respuesta grabada (`fixtures/llm/*.json`). */
function recorded(name: string) {
  const result = JSON.parse(
    readFileSync(new URL(`../fixtures/llm/${name}.json`, import.meta.url), "utf8"),
  ) as LlmResult<unknown>;
  const extractJson = vi.fn(async () => result);
  return { extractJson } as unknown as LlmClient & { extractJson: typeof extractJson };
}

const NOW = new Date("2026-11-12T09:00:00-06:00");
const TODAY = "2026-11-12";

function ctx(llm: LlmClient | null, over: Parameters<typeof ruleContext>[1] = {}): AnalyzeContext {
  return { ...ruleContext(TODAY, over), catalog: CATALOG, timeZone: TZ, llm };
}

describe("analyze: cuándo se llama al LLM", () => {
  it("los descartes de las reglas 1 a 3 y los mensajes completos no lo llaman", async () => {
    const llm = recorded("turno-desde-llm");
    for (const id of ["juarez-13", "piramides-52", "hoy-51", "cumbres-3"]) {
      const m = REAL_MESSAGES.find((x) => x.id === id)!;
      const r = await analyze(m.text, new Date(m.at), ctx(llm));
      expect(r.llmCalled, id).toBe(false);
      expect(r.decision.kind, id).toBe(m.expected.decision);
    }
    expect(llm.extractJson).not.toHaveBeenCalled();
  });

  it("jueves y viernes: lo llama y queda en NOTIFICAR varios_dias", async () => {
    const m = REAL_MESSAGES.find((x) => x.id === "jueves-viernes-53")!;
    const llm = recorded("jueves-viernes-53");
    const r = await analyze(m.text, new Date(m.at), {
      ...ruleContext("2026-11-10"),
      catalog: CATALOG,
      timeZone: TZ,
      llm,
    });
    expect(r.llmCalled).toBe(true);
    expect(r.decision).toMatchObject({ kind: "NOTIFICAR", reasons: ["varios_dias"] });
    expect(r.extraction).toMatchObject({
      source: "mixed",
      dates: ["2026-11-12", "2026-11-13"],
      llm: { model: "gpt-6-luna" },
    });
    const call = llm.extractJson.mock.calls[0] as unknown as [
      { system: string; user: string; name: string },
    ];
    expect(call[0].system).toBe(SYSTEM_PROMPT);
    expect(call[0].user).toContain(
      "Fecha y hora actual: martes 2026-11-10 15:12 (America/Matamoros)",
    );
    expect(call[0].user).toContain(JSON.stringify(m.text));
  });

  it("sin turno en el texto: el LLM lo completa y se aparta", async () => {
    const r = await analyze(
      "busco cobertura hoy reynosa 3 cumbres",
      NOW,
      ctx(recorded("turno-desde-llm")),
    );
    expect(r.llmCalled).toBe(true);
    expect(r.extraction).toMatchObject({ shift: "matutino", confidence: 0.92 });
    expect(r.decision).toMatchObject({ kind: "APARTAR", reasons: ["cumple"] });
  });
});

describe("analyze: combinación regex más LLM (7.6)", () => {
  it("si el LLM contradice un campo resuelto por el regex, la confianza baja a 0.5", async () => {
    // Fechas inseguras (fin de semana) para forzar la llamada; turno matutino resuelto por el regex.
    const r = await analyze(
      "busco cobertura hoy matutino o el fin de semana reynosa 3 cumbres",
      NOW,
      ctx(recorded("contradice-turno")),
    );
    expect(r.extraction).toMatchObject({ shift: "matutino", confidence: 0.5 });
    expect(r.decision).toMatchObject({ kind: "NOTIFICAR", reasons: ["baja_confianza"] });
  });

  it("fechas del LLM fuera de rango bajan la confianza", async () => {
    const r = await analyze(
      "busco cobertura la otra semana matutino reynosa 3 cumbres",
      NOW,
      ctx(recorded("fecha-lejana-llm")),
    );
    expect(r.extraction).toMatchObject({ dates: ["2027-03-01"], confidence: 0.5 });
    expect(r.decision).toMatchObject({ kind: "NOTIFICAR", reasons: ["baja_confianza"] });
  });
});

describe("analyze: expresiones de fecha que el regex no reconoce", () => {
  it("aunque el LLM esté seguro, van a NOTIFICAR (el doctor decide)", async () => {
    const r = await analyze(
      "Necesito cobertura la próxima semana el martes matutino reynosa 3 cumbres",
      NOW,
      ctx(recorded("turno-desde-llm")),
    );
    expect(r.llmCalled).toBe(true);
    expect(r.extraction.confidence).toBe(0.7);
    expect(r.decision).toMatchObject({ kind: "NOTIFICAR", reasons: ["baja_confianza"] });
  });
});

describe("analyze: fallas del LLM terminan en NOTIFICAR con su motivo", () => {
  it.each([
    ["refusal", "refusal"],
    ["max-tokens", "max_tokens"],
    ["timeout", "timeout"],
    ["budget-exhausted", "budget_exhausted"],
  ] as const)("%s", async (fixture, reason) => {
    const r = await analyze("busco cobertura hoy reynosa 3 cumbres", NOW, ctx(recorded(fixture)));
    expect(r.llmCalled).toBe(true);
    expect(r.extraction).toMatchObject({ failed: true, llmFailure: reason });
    expect(r.decision).toMatchObject({
      kind: "NOTIFICAR",
      reasons: ["baja_confianza"],
      notify: "high",
    });
  });

  it("sin LLM configurado se decide con el regex", async () => {
    const r = await analyze("busco cobertura hoy reynosa 3 cumbres", NOW, ctx(null));
    expect(r.llmCalled).toBe(false);
    expect(r.decision).toMatchObject({ kind: "NOTIFICAR", reasons: ["turno_desconocido"] });
  });
});

describe("prompt", () => {
  it("formatNow usa la zona y el día de la semana en español", () => {
    expect(formatNow(new Date("2026-11-09T13:40:00Z"), TZ)).toBe("lunes 2026-11-09 07:40");
    expect(formatNow(new Date("2026-03-10T05:30:00Z"), TZ)).toBe("martes 2026-03-10 00:30");
  });

  it("el texto va escapado y el sistema no nombra modelo ni proveedor", () => {
    const user = buildUserPrompt('Hola "doctor"\nlinea 2', NOW, TZ);
    expect(user).toContain('"Hola \\"doctor\\"\\nlinea 2"');
    expect(SYSTEM_PROMPT).not.toMatch(/haiku|claude|gpt|openai|anthropic/i);
  });
});
