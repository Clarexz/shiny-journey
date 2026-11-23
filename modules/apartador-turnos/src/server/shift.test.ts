import { describe, expect, it } from "vitest";
import { REAL_MESSAGES } from "../../fixtures/real-messages";
import { normalize } from "./normalize";
import { extractShift } from "./shift";

const shift = (t: string) => extractShift(normalize(t));

describe("extractShift (7.3)", () => {
  it.each([
    ["turno matutino", "matutino"],
    ["Turno de la mañana", "matutino"],
    ["turno de manana", "matutino"],
    ["mañana en la mañana", "matutino"],
    ["por la mañana", "matutino"],
    ["vespertino", "vespertino"],
    ["turno de la tarde", "vespertino"],
    ["ambos turnos", "ambos"],
    ["los dos turnos", "ambos"],
    ["turno completo", "ambos"],
    ["todo el día", "ambos"],
    ["matutino y vespertino", "ambos"],
    ["matutino, y en la tarde también", "ambos"],
    ["para mañana", null],
    ["buenas tardes, busco cobertura", null],
    ["buenos días", null],
  ])("%s -> %s", (text, expected) => {
    expect(shift(text)).toBe(expected);
  });

  it("los mensajes reales dan su turno", () => {
    for (const m of REAL_MESSAGES) expect(shift(m.text), m.id).toBe(m.expected.shift);
  });
});
