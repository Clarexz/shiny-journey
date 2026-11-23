import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCTOR_ACCEPTED } from "../../fixtures/doctor-accepted";
import { REAL_MESSAGES } from "../../fixtures/real-messages";
import { keywordConflicts, parseBranchesCsv } from "../catalog/branches";
import { BRANCHES_CSV_FILE } from "../catalog/sql";
import { BranchCatalog, aliasConflicts, resolveBranch, type AcceptedBranch } from "./branch";
import { normalize } from "./normalize";
import { extractBranchNumbers } from "./prefilter";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const branches = parseBranchesCsv(readFileSync(root + BRANCHES_CSV_FILE, "utf8"));
const catalog = new BranchCatalog(branches);

const resolve = (n: number, text: string, accepted: readonly AcceptedBranch[] = DOCTOR_ACCEPTED) =>
  resolveBranch(n, normalize(text), catalog, accepted, normalize);

describe("resolveBranch (7.5)", () => {
  it("los 5 mensajes reales dan la sucursal esperada", () => {
    for (const m of REAL_MESSAGES) {
      const text = normalize(m.text);
      const [n] = extractBranchNumbers(text);
      const r = resolveBranch(n!, text, catalog, DOCTOR_ACCEPTED, normalize);
      expect({ code: r.code, status: r.status, acceptance: r.acceptance }, m.id).toEqual({
        code: m.expected.branchCode,
        status: m.expected.branchStatus,
        acceptance: m.expected.acceptance,
      });
    }
  });

  it("número desconocido", () => {
    expect(resolve(53, "cobertura reynosa 53")).toMatchObject({
      status: "desconocida",
      acceptance: "desconocida",
      candidates: [],
    });
  });

  it("gemelas: la palabra clave decide", () => {
    expect(resolve(3, "cobertura reynosa 3 cumbres")).toMatchObject({
      code: "S-0404",
      matchedBy: "palabra_clave",
      acceptance: "aceptada",
    });
    expect(resolve(3, "cobertura reynosa 3 benito juarez")).toMatchObject({
      code: "FC-1228",
      acceptance: "no_aceptada",
    });
    // Sin palabra clave: ambigua mixta (una aceptada y una no).
    expect(resolve(3, "cobertura reynosa 3")).toMatchObject({
      status: "ambigua",
      acceptance: "mixta",
      candidates: ["FC-1228", "S-0404"],
      accepted: { code: "S-0404", label: "Cumbres" },
    });
  });

  it("número con un solo candidato", () => {
    expect(resolve(52, "reynosa 52")).toMatchObject({
      code: "F-8013",
      matchedBy: "unico",
      acceptance: "no_aceptada",
    });
    expect(resolve(50, "reynosa 50")).toMatchObject({
      code: "F-7456",
      matchedBy: "unico",
      acceptance: "aceptada",
    });
    expect(resolve(1, "reynosa 1")).toMatchObject({ code: "S-0202", acceptance: "aceptada" });
  });

  it("Reynosa 30: las dos gemelas son aceptadas, así que sin palabra clave se acepta", () => {
    expect(resolve(30, "reynosa 30")).toMatchObject({
      status: "ambigua",
      code: null,
      acceptance: "aceptada",
    });
    expect(resolve(30, "reynosa 30 caracoles")).toMatchObject({
      code: "F-4224",
      acceptance: "aceptada",
    });
    expect(resolve(30, "reynosa 30 hacienda del sol")).toMatchObject({
      code: "S-2266",
      acceptance: "aceptada",
    });
  });

  it("Reynosa 11 Olmo (sin código): con 'olmo' se acepta; sin él, siempre mixta", () => {
    expect(resolve(11, "cobertura reynosa 11 olmo")).toMatchObject({
      status: "resuelta",
      code: null,
      matchedBy: "alias",
      acceptance: "aceptada",
      accepted: { label: "Olmo" },
    });
    // Aunque diga "moderno" (S-1005), sin "olmo" no se sabe si es la del doctor.
    expect(resolve(11, "cobertura reynosa 11 moderno")).toMatchObject({
      acceptance: "mixta",
      code: null,
    });
    expect(resolve(11, "cobertura reynosa 11")).toMatchObject({
      status: "ambigua",
      acceptance: "mixta",
      accepted: { label: "Olmo" },
    });
  });

  it("Reynosa 22 Jarachina Sur (F-0651): con palabra clave o con la referencia", () => {
    expect(resolve(22, "reynosa 22 jarachina")).toMatchObject({
      code: "F-0651",
      acceptance: "aceptada",
    });
    expect(resolve(22, "reynosa 22 jarachina sur")).toMatchObject({
      code: "F-0651",
      acceptance: "aceptada",
    });
    expect(resolve(22, "reynosa 22 la cañada")).toMatchObject({
      code: "S-2012",
      acceptance: "no_aceptada",
    });
    expect(resolve(22, "reynosa 22")).toMatchObject({ status: "ambigua", acceptance: "mixta" });
  });

  it("los alias del doctor cuentan como palabra clave de su sucursal", () => {
    expect(resolve(4, "reynosa 4 blv hidalgo")).toMatchObject({
      code: "S-0414",
      acceptance: "aceptada",
    });
    const withAlias: AcceptedBranch[] = [
      { number: 3, code: "S-0404", label: "Cumbres", aliases: ["la del oxxo"] },
    ];
    expect(resolve(3, "reynosa 3 la del oxxo", withAlias)).toMatchObject({ code: "S-0404" });
  });

  it("si el texto nombra a las dos gemelas, queda ambigua entre ellas", () => {
    expect(resolve(3, "reynosa 3 cumbres o benito juarez")).toMatchObject({
      status: "ambigua",
      acceptance: "mixta",
      candidates: ["FC-1228", "S-0404"],
    });
  });

  it("todos los números de la lista del doctor se resuelven con su palabra clave o referencia", () => {
    for (const a of DOCTOR_ACCEPTED) {
      const r = resolve(a.number, `cobertura reynosa ${a.number} ${a.label}`);
      expect(r.acceptance, `${a.number} ${a.label}`).toBe("aceptada");
      if (a.code) expect(r.code, `${a.number} ${a.label}`).toBe(a.code);
    }
  });
});

describe("unicidad de palabras clave por número", () => {
  it("ninguna palabra clave del catálogo se repite dentro de un número", () => {
    expect(keywordConflicts(branches)).toEqual([]);
  });

  it("los alias y referencias del doctor no chocan con las gemelas", () => {
    expect(aliasConflicts(DOCTOR_ACCEPTED, catalog, normalize)).toEqual([]);
  });

  it("detecta un alias que apunta a la gemela", () => {
    const bad: AcceptedBranch[] = [
      { number: 3, code: "S-0404", label: "Cumbres", aliases: ["benito juarez"] },
    ];
    expect(aliasConflicts(bad, catalog, normalize)).toEqual([
      { number: 3, phrase: "benito juarez", codes: ["S-0404", "FC-1228"] },
    ]);
  });
});
