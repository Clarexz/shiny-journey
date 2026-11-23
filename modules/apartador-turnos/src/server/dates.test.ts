import { describe, expect, it } from "vitest";
import { REAL_MESSAGES } from "../../fixtures/real-messages";
import { localDate, parseDates } from "./dates";
import { normalize } from "./normalize";

// Jueves 12 de noviembre de 2026, 13:05 en Matamoros (CST, UTC-6).
const JUE = "2026-11-12T13:05:00-06:00";

const parse = (text: string, at: string = JUE) => parseDates(normalize(text), new Date(at));

describe("parseDates: los 5 mensajes reales", () => {
  it.each(REAL_MESSAGES.map((m) => [m.id, m] as const))("%s", (_id, m) => {
    expect(parse(m.text, m.at).dates).toEqual(m.expected.dates);
  });

  it("los de una sola fecha no necesitan LLM; jueves y viernes sí (varias fechas)", () => {
    const byId = Object.fromEntries(REAL_MESSAGES.map((m) => [m.id, parse(m.text, m.at)]));
    for (const id of ["juarez-13", "piramides-52", "hoy-51", "cumbres-3"]) {
      expect(byId[id], id).toMatchObject({ confidence: 1, requiresLlm: false, issues: [] });
    }
    expect(byId["jueves-viernes-53"]).toMatchObject({
      confidence: 0.9,
      requiresLlm: true,
      issues: ["varias_fechas"],
    });
  });
});

describe("parseDates: expresiones simples (jueves 2026-11-12)", () => {
  it.each([
    ["cobertura hoy", ["2026-11-12"]],
    ["cobertura el dia de hoy", ["2026-11-12"]],
    ["para mañana", ["2026-11-13"]],
    ["el día de mañana", ["2026-11-13"]],
    ["mañana turno matutino", ["2026-11-13"]],
    ["mañana viernes", ["2026-11-13"]],
    ["pasado mañana", ["2026-11-14"]],
    ["este jueves", ["2026-11-12"]],
    ["el jueves", ["2026-11-12"]],
    ["próximo jueves", ["2026-11-19"]],
    ["el viernes", ["2026-11-13"]],
    ["este sábado", ["2026-11-14"]],
    ["el miércoles", ["2026-11-18"]],
    ["domingo", ["2026-11-15"]],
    ["15 de noviembre", ["2026-11-15"]],
    ["15 noviembre", ["2026-11-15"]],
    ["el 3 de dic", ["2026-12-03"]],
    ["dia 20 de noviembre", ["2026-11-20"]],
    ["domingo 15 noviembre", ["2026-11-15"]],
    ["hoy 12 de noviembre", ["2026-11-12"]],
    ["hoy 12", ["2026-11-12"]],
    ["viernes 13", ["2026-11-13"]],
    ["sábado, 14 de noviembre", ["2026-11-14"]],
  ])("%s -> %j", (text, dates) => {
    expect(parse(`busco cobertura ${text} reynosa 3`)).toMatchObject({
      dates,
      confidence: 1,
      requiresLlm: false,
    });
  });
});

describe("parseDates: 'mañana' como fecha frente a 'mañana' como turno", () => {
  it("de la mañana, en la mañana, por la mañana y turno de la mañana son turno", () => {
    for (const t of ["turno de la mañana", "en la mañana", "por la mañana", "turno de mañana"]) {
      expect(parse(`cobertura hoy ${t} reynosa 3`).dates, t).toEqual(["2026-11-12"]);
    }
  });

  it("mañana en la mañana: fecha y turno a la vez", () => {
    expect(parse("Necesito cobertura mañana en la mañana reynosa 15")).toMatchObject({
      dates: ["2026-11-13"],
      confidence: 0.85,
      requiresLlm: false,
      issues: ["manana_ambigua"],
    });
  });

  it("solo 'en la mañana' sin fecha: no hay fecha", () => {
    expect(parse("cobertura en la mañana reynosa 3")).toMatchObject({
      dates: [],
      confidence: 0,
      requiresLlm: true,
      issues: ["sin_fecha"],
    });
  });
});

describe("parseDates: incoherencias y casos para el LLM", () => {
  it("'hoy 9' cuando hoy es 10: se usa el número con confianza baja", () => {
    expect(parse("cobertura hoy 9 noviembre", "2026-11-10T08:00:00-06:00")).toMatchObject({
      dates: ["2026-11-09"],
      confidence: 0.3,
      requiresLlm: true,
      issues: ["incoherente"],
    });
    expect(parse("cobertura hoy 9", "2026-11-10T08:00:00-06:00")).toMatchObject({
      dates: ["2026-11-10"],
      requiresLlm: true,
      issues: ["incoherente"],
    });
  });

  it("'domingo 16 noviembre' (el 16 es lunes): incoherente", () => {
    expect(parse("cobertura domingo 16 noviembre")).toMatchObject({
      dates: ["2026-11-16"],
      confidence: 0.3,
      issues: ["incoherente"],
    });
  });

  it("varias fechas", () => {
    expect(parse("cobertura jueves y viernes")).toMatchObject({
      dates: ["2026-11-12", "2026-11-13"],
      requiresLlm: true,
      issues: ["varias_fechas"],
    });
    expect(parse("cobertura 14 y 15 de noviembre")).toMatchObject({
      dates: ["2026-11-14", "2026-11-15"],
      requiresLlm: true,
      issues: ["varias_fechas"],
    });
    expect(parse("cobertura 14, 15 y 16 de nov").dates).toEqual([
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
    ]);
    expect(parse("cobertura hoy y mañana").dates).toEqual(["2026-11-12", "2026-11-13"]);
  });

  it.each([
    "fin de semana",
    "la otra semana",
    "del 14 al 16",
    "de lunes a viernes",
    "la semana que entra",
  ])("expresión no reconocida: %s", (t) => {
    const r = parse(`cobertura ${t} reynosa 3`);
    expect(r.requiresLlm).toBe(true);
    expect(r.issues).toContain("expresion_no_reconocida");
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });

  it("fecha inválida", () => {
    expect(parse("cobertura 31 de noviembre")).toMatchObject({
      dates: [],
      requiresLlm: true,
      issues: expect.arrayContaining(["fecha_invalida", "sin_fecha"]),
    });
  });

  it("los números de sucursal no se confunden con días", () => {
    expect(parse("cobertura hoy turno matutino en Reynosa 15").dates).toEqual(["2026-11-12"]);
    expect(parse("cobertura reynosa 15 noviembre? no, hoy").dates).toEqual([
      "2026-11-12",
      "2026-11-15",
    ]);
  });
});

describe("parseDates: cambio de año", () => {
  it("'2 de enero' dicho el 30 de diciembre es del año siguiente", () => {
    expect(parse("cobertura 2 de enero", "2026-12-30T10:00:00-06:00").dates).toEqual([
      "2027-01-02",
    ]);
  });

  it("'28 de diciembre' dicho el 30 de diciembre sigue siendo este año (pasada hace menos de 7 días)", () => {
    expect(parse("cobertura 28 de diciembre", "2026-12-30T10:00:00-06:00").dates).toEqual([
      "2026-12-28",
    ]);
  });

  it("'mañana' el 31 de diciembre y 'viernes 1' en diciembre", () => {
    expect(parse("cobertura para mañana", "2026-12-31T10:00:00-06:00").dates).toEqual([
      "2027-01-01",
    ]);
    expect(parse("cobertura viernes 1", "2026-12-30T10:00:00-06:00")).toMatchObject({
      dates: ["2027-01-01"],
      confidence: 1,
    });
  });
});

describe("parseDates: zona horaria y horario de verano (America/Matamoros)", () => {
  it("'hoy' cerca de medianoche depende del horario de verano", () => {
    // 10 de marzo de 2026, 00:30 CDT (UTC-5). Con un -6 fijo saldría el 9.
    expect(parseDates("cobertura hoy", new Date("2026-03-10T05:30:00Z")).dates).toEqual([
      "2026-03-10",
    ]);
    // 6 de marzo de 2026, 23:30 CST (UTC-6), antes del cambio.
    expect(parseDates("cobertura hoy", new Date("2026-03-07T05:30:00Z")).dates).toEqual([
      "2026-03-06",
    ]);
    // 1 de noviembre de 2026, 23:30 CST, después del regreso al horario normal.
    expect(parseDates("cobertura hoy", new Date("2026-11-02T05:30:00Z")).dates).toEqual([
      "2026-11-01",
    ]);
  });

  it("sumar días cruzando el cambio de horario no se desfasa", () => {
    expect(parseDates("cobertura domingo", new Date("2026-03-06T18:00:00Z")).dates).toEqual([
      "2026-03-08",
    ]);
    expect(parseDates("cobertura pasado manana", new Date("2026-10-31T18:00:00Z")).dates).toEqual([
      "2026-11-02",
    ]);
  });

  it("localDate usa la zona indicada", () => {
    const now = new Date("2026-11-12T03:00:00Z");
    expect(localDate(now)).toEqual({ y: 2026, m: 11, d: 11 });
    expect(localDate(now, "UTC")).toEqual({ y: 2026, m: 11, d: 12 });
  });
});
