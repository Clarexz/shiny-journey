import { describe, expect, it } from "vitest";
import { DOCTOR_ACCEPTED } from "../fixtures/doctor-accepted";
import { REAL_MESSAGES } from "../fixtures/real-messages";
import { localDate, fmt } from "../src/server/dates";
import { extractDeterministic } from "../src/server/extract";
import { normalize } from "../src/server/normalize";
import { prefilter } from "../src/server/prefilter";
import { evaluateRules } from "../src/server/rules";
import { CATALOG, TZ, ruleContext } from "./helpers";

/**
 * Prueba de aceptación de T1.12: los 5 mensajes reales reproducen exactamente la tabla de 7.7
 * (doctor disponible todos los días, sin turnos apartados). Con el LLM simulado se amplía en
 * T1.13 y con el pipeline completo en T1.15.
 */
describe("mensajes reales: tabla de resultados de 7.7", () => {
  it.each(REAL_MESSAGES.map((m) => [m.id, m] as const))("%s", async (_id, m) => {
    const now = new Date(m.at);
    expect(prefilter(normalize(m.text))).toBe(true);
    const ex = extractDeterministic(m.text, now, {
      catalog: CATALOG,
      accepted: DOCTOR_ACCEPTED,
      timeZone: TZ,
    });
    expect(ex.branches[0]).toMatchObject({
      code: m.expected.branchCode,
      acceptance: m.expected.acceptance,
    });
    expect(ex.shift).toBe(m.expected.shift);
    expect(ex.dates).toEqual(m.expected.dates);

    const d = await evaluateRules(ex, ruleContext(fmt(localDate(now, TZ))));
    expect({ kind: d.kind, reasons: d.reasons }).toEqual({
      kind: m.expected.decision,
      reasons: [m.expected.reason],
    });
  });

  it("los descartes de sucursal no necesitan el LLM (se deciden con el regex)", () => {
    for (const id of ["juarez-13", "piramides-52", "hoy-51"]) {
      const m = REAL_MESSAGES.find((x) => x.id === id)!;
      const ex = extractDeterministic(m.text, new Date(m.at), {
        catalog: CATALOG,
        accepted: DOCTOR_ACCEPTED,
        timeZone: TZ,
      });
      expect(ex.needsLlm, id).toBe(false);
    }
  });
});
