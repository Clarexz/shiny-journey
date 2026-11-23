import { describe, expect, it } from "vitest";
import { DOCTOR_ACCEPTED } from "../fixtures/doctor-accepted";
import { ApartadorConfigSchema, DEFAULT_TEMPLATES, defaultApartadorConfig } from "./config";

const issues = (raw: unknown) => {
  const r = ApartadorConfigSchema.safeParse(raw);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("ApartadorConfigSchema (7.1)", () => {
  it("el config por defecto es válido y tiene los valores del plan", () => {
    const c = defaultApartadorConfig();
    expect(c).toMatchObject({
      groupJid: null,
      city: "reynosa",
      ambiguityPolicy: "ask_in_dm",
      shifts: { allowed: ["matutino"], bothShiftsRequest: "discard" },
      availability: { weekdays: [0, 1, 2, 3, 4, 5, 6], maxDaysAhead: 21, oneShiftPerDay: true },
      minConfidence: 0.8,
      sending: { maxPerHour: 6, maxPerDay: 15, minGapSameContactMin: 30, targetTotalMs: 1800 },
      notifyDiscarded: false,
      llmMonthlyBudgetUsd: 1,
    });
    expect(c.templates).toEqual(DEFAULT_TEMPLATES);
    expect(c.templates.interest).toHaveLength(8);
  });

  it("acepta la lista del doctor", () => {
    expect(
      issues({ groupJid: "120363000000000001@g.us", branches: { accepted: DOCTOR_ACCEPTED } }),
    ).toEqual([]);
  });

  it("rechaza grupo, clave y sucursal repetida", () => {
    expect(issues({ groupJid: "5218990000001@s.whatsapp.net" })).toEqual([
      "groupJid: debe ser un JID de grupo",
    ]);
    expect(issues({ branches: { accepted: [{ number: 3, code: "s-404", label: "x" }] } })).toEqual([
      "branches.accepted.0.code: clave inválida",
    ]);
    const dup = { number: 3, code: "S-0404", label: "Cumbres" };
    expect(issues({ branches: { accepted: [dup, dup] } })).toEqual([
      "branches.accepted.1: sucursal repetida",
    ]);
  });

  it("valida las plantillas: mínimo, placeholders, enlaces, emojis, {colonia} e ids", () => {
    const t = (id: string, text: string) => ({ id, text });
    const interest = DEFAULT_TEMPLATES.interest;
    expect(issues({ templates: { ...DEFAULT_TEMPLATES, interest: interest.slice(0, 4) } })).toEqual(
      ["templates.interest: al menos 5 plantillas"],
    );
    expect(
      issues({
        templates: {
          ...DEFAULT_TEMPLATES,
          interest: [
            ...interest.slice(0, 4),
            t("x.1", "Hola {doctor}, me interesa"),
            t("x.2", "Me interesa, mira www.ejemplo.com"),
            t("x.3", "Me interesa 🙏 de verdad"),
            t("interest.1", "Otra con id repetido"),
          ],
        },
      }),
    ).toEqual([
      "templates.interest.4.text: placeholder desconocido: {doctor}",
      "templates.interest.5.text: sin enlaces",
      "templates.interest.6.text: sin emojis",
      "templates.interest.7.id: id repetido",
    ]);
    expect(
      issues({
        templates: {
          ...DEFAULT_TEMPLATES,
          interestAmbiguous: [
            ...DEFAULT_TEMPLATES.interestAmbiguous.slice(0, 2),
            t("a.9", "Hola, me interesa"),
          ],
        },
      }),
    ).toEqual(["templates.interestAmbiguous.2.text: debe incluir {colonia}"]);
  });

  it("rechaza turnos vacíos y retrasos invertidos", () => {
    expect(issues({ shifts: { allowed: [] } })).toHaveLength(1);
    expect(issues({ sending: { minDelayMs: 900, maxDelayMs: 500 } })).toEqual([
      "sending.maxDelayMs: maxDelayMs debe ser mayor o igual que minDelayMs",
    ]);
  });
});
