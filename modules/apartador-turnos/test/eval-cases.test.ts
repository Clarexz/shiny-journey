import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOCTOR_ACCEPTED } from "../fixtures/doctor-accepted";
import { extractDeterministic } from "../src/server/extract";
import { normalize } from "../src/server/normalize";
import { prefilter } from "../src/server/prefilter";
import { CATALOG, TZ } from "./helpers";

interface EvalCase {
  id: string;
  text: string;
  at: string;
  expected: { numero: number; fechas: string[]; turno: string | null };
}

const { cases } = JSON.parse(
  readFileSync(new URL("../fixtures/eval/extractor-cases.json", import.meta.url), "utf8"),
) as { cases: EvalCase[] };

describe("set de evaluación del extractor", () => {
  it("tiene al menos 40 casos con ids únicos y fechas válidas", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      for (const d of c.expected.fechas) expect(d, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(c.at).getTime()), c.id).toBe(false);
    }
  });

  it("todos pasan el prefiltro", () => {
    for (const c of cases) expect(prefilter(normalize(c.text)), c.id).toBe(true);
  });

  it("donde el regex está seguro, coincide con lo esperado (revisa el set y el parser)", () => {
    let sure = 0;
    for (const c of cases) {
      const ex = extractDeterministic(c.text, new Date(c.at), {
        catalog: CATALOG,
        accepted: DOCTOR_ACCEPTED,
        timeZone: TZ,
      });
      expect(ex.branchNumbers[0], c.id).toBe(c.expected.numero);
      if (ex.confidence === 1 && !ex.needsLlm) {
        sure++;
        expect(ex.dates, c.id).toEqual(c.expected.fechas);
      }
      if (ex.shift !== null) expect(ex.shift, c.id).toBe(c.expected.turno);
    }
    expect(sure).toBeGreaterThan(20);
  });
});
