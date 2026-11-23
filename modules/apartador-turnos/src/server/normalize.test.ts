import { describe, expect, it } from "vitest";
import { containsPhrase, normalize } from "./normalize";

describe("normalize (7.2)", () => {
  it.each([
    ["Buenas tardes solicito.cobertura", "buenas tardes solicito cobertura"],
    ["en la.juarez 2", "en la juarez 2"],
    ["turno_matutino", "turno matutino"],
    ["MAÑANA en la mañana", "manana en la manana"],
    ["Reynosa 52 pirámides", "reynosa 52 piramides"],
    ["reynosa13", "reynosa 13"],
    ["15noviembre", "15 noviembre"],
    ["🙏🏽 Busco cobertura 😊 por favor ❤️", "busco cobertura por favor"],
    ["  muchos    espacios \n y saltos ", "muchos espacios y saltos"],
    ["reynosa 13,en turno", "reynosa 13,en turno"],
    ["S.A. de C.V.", "s a. de c v."],
  ])("%j -> %j", (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it("es idempotente", () => {
    const once = normalize("Solicito.cobertura HOY 🙏 reynosa13, Pirámides");
    expect(normalize(once)).toBe(once);
  });
});

describe("containsPhrase", () => {
  it("solo cuenta palabras o frases completas", () => {
    expect(containsPhrase("reynosa 3 cumbres", "cumbres")).toBe(true);
    expect(containsPhrase("reynosa 3 mil cumbres hoy", "mil cumbres")).toBe(true);
    expect(containsPhrase("lomas de jarachinas", "jarachina")).toBe(false);
    expect(containsPhrase("reynosa 22 jarachina, hoy", "jarachina")).toBe(true);
    expect(containsPhrase("centros", "centro")).toBe(false);
    expect(containsPhrase("algo", "")).toBe(false);
  });
});
