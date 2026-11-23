import { describe, expect, it } from "vitest";
import { REAL_MESSAGES } from "../../fixtures/real-messages";
import { normalize } from "./normalize";
import { extractBranchNumbers, prefilter } from "./prefilter";

const pass = (text: string) => prefilter(normalize(text));

describe("prefilter (7.3)", () => {
  it.each(REAL_MESSAGES.map((m) => [m.id, m.text] as const))(
    "pasa el mensaje real %s",
    (_id, text) => {
      expect(pass(text)).toBe(true);
    },
  );

  it.each([
    "gracias por la cobertura de ayer",
    "reynosa 3 hoy matutino",
    "Buenos días a todos",
    "la cobertura en reynosa es mala",
    "descubre el nuevo menu de reynosa 3",
  ])("no pasa: %s", (text) => {
    expect(pass(text)).toBe(false);
  });

  it("acepta coberturas y las formas de cubrir", () => {
    expect(pass("Alguien que me cubra mañana en reynosa 3?")).toBe(true);
    expect(pass("quien me cubre hoy reynosa 30")).toBe(true);
    expect(pass("2 coberturas reynosa 4")).toBe(true);
    expect(pass("Solicito cobertura Reynosa13")).toBe(true);
  });
});

describe("extractBranchNumbers", () => {
  it("devuelve los números distintos en orden", () => {
    expect(
      extractBranchNumbers(normalize("cobertura reynosa 3 y Reynosa 30, también reynosa 3")),
    ).toEqual([3, 30]);
    expect(extractBranchNumbers(normalize("reynosa13,en turno"))).toEqual([13]);
    expect(extractBranchNumbers("reynosa 0")).toEqual([]);
    expect(extractBranchNumbers("cobertura en la juarez 2")).toEqual([]);
  });

  it("los mensajes reales dan su número", () => {
    for (const m of REAL_MESSAGES) {
      expect(extractBranchNumbers(normalize(m.text)), m.id).toEqual(m.expected.branchNumbers);
    }
  });
});
