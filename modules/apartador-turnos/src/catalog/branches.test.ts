import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MANUAL_KEYWORDS,
  deriveKeywords,
  keywordConflicts,
  normalizeKeyword,
  parseBranchesCsv,
  parseCsv,
} from "./branches";
import { BRANCHES_CSV_FILE, BRANCHES_MIGRATION_FILE, branchesMigrationSql } from "./sql";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const branches = parseBranchesCsv(readFileSync(root + BRANCHES_CSV_FILE, "utf8"));

describe("catálogo de sucursales", () => {
  it("tiene las 85 sucursales: 36 de la serie S y 49 de la F (0.1)", () => {
    expect(branches).toHaveLength(85);
    expect(branches.filter((b) => b.series === "S")).toHaveLength(36);
    expect(branches.filter((b) => b.series === "F")).toHaveLength(49);
    expect(Math.min(...branches.map((b) => b.number))).toBe(1);
    expect(Math.max(...branches.map((b) => b.number))).toBe(52);
  });

  it("ninguna palabra clave se repite entre sucursales del mismo número (7.5)", () => {
    expect(keywordConflicts(branches)).toEqual([]);
  });

  it("las palabras clave están normalizadas y no incluyen 'reynosa'", () => {
    for (const b of branches) {
      for (const k of b.keywords) {
        expect(k).toBe(normalizeKeyword(k));
        expect(k).toMatch(/^[a-z0-9 ]+$/);
        expect(k).not.toBe("reynosa");
      }
    }
  });

  it("incluye los ajustes manuales de 7.5 en las sucursales del doctor", () => {
    const byCode = new Map(branches.map((b) => [b.code, b]));
    for (const [code, keywords] of Object.entries(MANUAL_KEYWORDS)) {
      expect(byCode.get(code)?.keywords).toEqual(expect.arrayContaining([...keywords]));
    }
    expect(byCode.get("S-0404")?.keywords).toContain("cumbres");
    expect(byCode.get("FC-1228")?.keywords).not.toContain("cumbres");
    // Reynosa 11 "Olmo" no tiene código: no va en el catálogo, sino en el config del tenant.
    expect(branches.some((b) => b.keywords.includes("olmo"))).toBe(false);
  });

  it("deriveKeywords quita prefijos, artículos, sufijos y 'reynosa'", () => {
    expect(deriveKeywords("LAS CUMBRES")).toEqual(["las cumbres", "cumbres"]);
    expect(deriveKeywords("FRACCIONAMIENTO PUERTA DEL SOL")).toEqual(["puerta del sol"]);
    expect(deriveKeywords("JOSE DE ESCANDON (PETROLERA)")).toEqual([
      "petrolera",
      "jose de escandon",
    ]);
    expect(deriveKeywords("LA CAÑADA 1, 2")).toEqual(["la canada", "canada"]);
    expect(deriveKeywords("AQUILES SERDAN I")).toEqual(["aquiles serdan"]);
    expect(deriveKeywords("REYNOSA CENTRO")).toEqual(["centro"]);
    expect(deriveKeywords("REYNOSA")).toEqual([]);
    expect(deriveKeywords("FRACC. BALCONES DE ALCALA")).toEqual(["balcones de alcala"]);
  });

  it("parseCsv respeta comillas, comas y comillas escapadas", () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("la migración de datos está al día con el CSV (npm run gen:branches)", () => {
    const onDisk = readFileSync(root + BRANCHES_MIGRATION_FILE, "utf8");
    expect(onDisk).toBe(branchesMigrationSql(branches));
  });

  it("rechaza un CSV con otro encabezado o columnas de menos", () => {
    expect(() => parseBranchesCsv("a,b\n1,2\n")).toThrow(/Encabezado/);
    expect(() =>
      parseBranchesCsv("clave,serie,numero,nombre_oficial,colonia,cp,direccion\nS-0001,S,1\n"),
    ).toThrow(/columnas/);
  });
});
