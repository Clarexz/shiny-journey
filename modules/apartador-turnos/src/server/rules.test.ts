import { describe, expect, it } from "vitest";
import { CATALOG, TZ, doctorConfig, ruleContext } from "../../test/helpers";
import { DOCTOR_ACCEPTED } from "../../fixtures/doctor-accepted";
import { extractDeterministic, type TurnoExtraction } from "./extract";
import { RULE_NUMBER, earlyDecision, evaluateRules, type RuleReason } from "./rules";

// Jueves 12 de noviembre de 2026, 09:00 en Matamoros.
const NOW = new Date("2026-11-12T09:00:00-06:00");
const TODAY = "2026-11-12";

const extract = (text: string, accepted = DOCTOR_ACCEPTED): TurnoExtraction =>
  extractDeterministic(text, NOW, { catalog: CATALOG, accepted, timeZone: TZ });

const decide = (
  text: string,
  ...args: Parameters<typeof ruleContext> extends [string, ...infer R] ? R : never
) => evaluateRules(extract(text), ruleContext(TODAY, ...args));

/** Mensaje que cumple todo: aceptada, hoy, matutino. */
const OK = "busco cobertura hoy matutino reynosa 3 cumbres";

describe("motor de reglas (7.7): una prueba por regla, en orden", () => {
  const cases: Array<[RuleReason, () => Promise<unknown>, string, string | null]> = [
    ["agente_pausado", () => decide(OK, { status: "paused" }), "DESCARTAR", null],
    [
      "sucursal_no_aceptada",
      () => decide("busco cobertura hoy matutino reynosa 51"),
      "DESCARTAR",
      null,
    ],
    [
      "turno_no_permitido",
      () => decide("busco cobertura hoy vespertino reynosa 3 cumbres"),
      "DESCARTAR",
      null,
    ],
    [
      "baja_confianza",
      () => decide("busco cobertura fin de semana matutino reynosa 3 cumbres"),
      "NOTIFICAR",
      "high",
    ],
    [
      "varias_sucursales",
      () => decide("busco cobertura hoy matutino reynosa 3 cumbres o reynosa 50"),
      "NOTIFICAR",
      "high",
    ],
    [
      "fecha_pasada",
      () => decide("busco cobertura 10 de noviembre matutino reynosa 3 cumbres"),
      "DESCARTAR",
      null,
    ],
    [
      "varios_dias",
      () => decide("busco cobertura viernes y sabado matutino reynosa 3 cumbres"),
      "NOTIFICAR",
      "high",
    ],
    [
      "ambos_turnos",
      () => decide("busco cobertura hoy ambos turnos reynosa 3 cumbres"),
      "DESCARTAR",
      null,
    ],
    [
      "turno_desconocido",
      () => decide("busco cobertura hoy reynosa 3 cumbres"),
      "NOTIFICAR",
      "high",
    ],
    [
      "sucursal_desconocida",
      () => decide("busco cobertura hoy matutino reynosa 53"),
      "NOTIFICAR",
      "normal",
    ],
    [
      "fecha_lejana",
      () => decide("busco cobertura 20 de diciembre matutino reynosa 3 cumbres"),
      "NOTIFICAR",
      "normal",
    ],
    [
      "dia_no_disponible",
      () => decide(OK, {}, { exceptions: { [TODAY]: false } }),
      "DESCARTAR",
      null,
    ],
    ["ya_tiene_turno", () => decide(OK, {}, { activeClaims: [TODAY] }), "DESCARTAR", null],
    [
      "duplicado",
      () => decide(OK, {}, { contacted: [`100000000000003@lid|${TODAY}|matutino`] }),
      "DESCARTAR",
      null,
    ],
    [
      "remitente_sin_numero",
      () =>
        decide(OK, {
          publisher: { jid: "1@lid", phone: null, lid: "1", name: null },
          canSendToLid: false,
        }),
      "NOTIFICAR",
      "high",
    ],
    ["limite_envios", () => decide(OK, {}, { budgetOk: false }), "NOTIFICAR", "high"],
    ["modo_observacion", () => decide(OK, { status: "observe" }), "OBSERVAR", "normal"],
    ["sucursal_ambigua", () => decide("busco cobertura hoy matutino reynosa 3"), "APARTAR", "high"],
    ["cumple", () => decide(OK), "APARTAR", "high"],
  ];

  it("cubre las 19 reglas", () => {
    expect(cases.map(([r]) => RULE_NUMBER[r])).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it.each(cases)("regla %s", async (reason, run, kind, notify) => {
    const d = await run();
    expect(d).toMatchObject({
      kind,
      reasons: [reason],
      notify,
      data: { rule: RULE_NUMBER[reason] },
    });
  });
});

describe("detalles de las reglas", () => {
  it("los descartes 'silencio' avisan solo con notifyDiscarded", async () => {
    const ctx = ruleContext(TODAY, { config: doctorConfig({ notifyDiscarded: true }) });
    expect(
      await evaluateRules(extract("busco cobertura hoy matutino reynosa 51"), ctx),
    ).toMatchObject({
      notify: "silent",
    });
    expect(
      await evaluateRules(
        extract("busco cobertura 10 de noviembre matutino reynosa 3 cumbres"),
        ctx,
      ),
    ).toMatchObject({ reasons: ["fecha_pasada"], notify: null });
  });

  it("ambos turnos con bothShiftsRequest=notify pasa a NOTIFICAR", async () => {
    const ctx = ruleContext(TODAY, {
      config: doctorConfig({ shifts: { allowed: ["matutino"], bothShiftsRequest: "notify" } }),
    });
    expect(
      await evaluateRules(extract("busco cobertura hoy ambos turnos reynosa 3 cumbres"), ctx),
    ).toMatchObject({
      kind: "NOTIFICAR",
      reasons: ["ambos_turnos"],
    });
  });

  it("la regla semanal y la excepción: la excepción manda", async () => {
    // Hoy es jueves (4). Sin jueves en la regla semanal: no disponible.
    const noThursday = doctorConfig({ availability: { weekdays: [0, 1, 2, 3, 5, 6] } });
    expect(
      await evaluateRules(extract(OK), ruleContext(TODAY, { config: noThursday })),
    ).toMatchObject({
      reasons: ["dia_no_disponible"],
    });
    expect(
      await evaluateRules(
        extract(OK),
        ruleContext(TODAY, { config: noThursday }, { exceptions: { [TODAY]: true } }),
      ),
    ).toMatchObject({ reasons: ["cumple"] });
  });

  it("maxDaysAhead: el último día permitido todavía aparta", async () => {
    expect(await decide("busco cobertura 3 de diciembre matutino reynosa 3 cumbres")).toMatchObject(
      {
        reasons: ["cumple"],
        data: { date: "2026-12-03" },
      },
    );
    expect(await decide("busco cobertura 4 de diciembre matutino reynosa 3 cumbres")).toMatchObject(
      {
        reasons: ["fecha_lejana"],
      },
    );
  });

  it("remitente @lid sin teléfono: se le escribe al @lid si el canal puede", async () => {
    const publisher = {
      jid: "100000000000003@lid",
      phone: null,
      lid: "100000000000003",
      name: null,
    };
    expect(await decide(OK, { publisher })).toMatchObject({
      reasons: ["cumple"],
      data: { sendTo: { jid: "100000000000003@lid" } },
    });
    expect(await decide(OK)).toMatchObject({ data: { sendTo: { phone: "5218990000002" } } });
  });

  it("ambigua mixta según ambiguityPolicy", async () => {
    const text = "busco cobertura hoy matutino reynosa 3";
    expect(await decide(text)).toMatchObject({
      kind: "APARTAR",
      data: { template: "interestAmbiguous", askLabel: "Cumbres" },
    });
    const notify = ruleContext(TODAY, { config: doctorConfig({ ambiguityPolicy: "notify" }) });
    expect(await evaluateRules(extract(text), notify)).toMatchObject({
      kind: "NOTIFICAR",
      reasons: ["sucursal_ambigua"],
    });
    const claim = ruleContext(TODAY, { config: doctorConfig({ ambiguityPolicy: "claim" }) });
    expect(await evaluateRules(extract(text), claim)).toMatchObject({
      kind: "APARTAR",
      data: { template: "interest", askLabel: null },
    });
    // Reynosa 11 sin "olmo": pregunta por la referencia.
    expect(await decide("busco cobertura hoy matutino reynosa 11")).toMatchObject({
      data: { template: "interestAmbiguous", askLabel: "Olmo" },
    });
  });

  it("en observación, una ambigua queda como OBSERVAR con su plantilla", async () => {
    expect(
      await decide("busco cobertura hoy matutino reynosa 3", { status: "observe" }),
    ).toMatchObject({
      kind: "OBSERVAR",
      data: { template: "interestAmbiguous", askLabel: "Cumbres" },
    });
  });

  it("con varias sucursales, solo descarta si todas son no aceptadas", async () => {
    expect(await decide("busco cobertura hoy matutino reynosa 51 o reynosa 52")).toMatchObject({
      reasons: ["sucursal_no_aceptada"],
    });
  });

  it("earlyDecision resuelve las reglas 1 a 3 sin fuentes externas", () => {
    expect(
      earlyDecision(extract("busco cobertura hoy matutino reynosa 51"), ruleContext(TODAY)),
    ).toMatchObject({
      reasons: ["sucursal_no_aceptada"],
    });
    expect(earlyDecision(extract(OK), ruleContext(TODAY))).toBeNull();
  });

  it("una extracción fallida es baja_confianza", async () => {
    const ex = { ...extract(OK), failed: true };
    expect(await evaluateRules(ex, ruleContext(TODAY))).toMatchObject({
      reasons: ["baja_confianza"],
    });
  });
});
