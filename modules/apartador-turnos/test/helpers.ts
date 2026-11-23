import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOCTOR_ACCEPTED } from "../fixtures/doctor-accepted";
import { parseBranchesCsv } from "../src/catalog/branches";
import { BRANCHES_CSV_FILE } from "../src/catalog/sql";
import { ApartadorConfigSchema, type ApartadorConfig } from "../src/config";
import { BranchCatalog } from "../src/server/branch";
import type { RuleContext } from "../src/server/rules";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export const CATALOG = new BranchCatalog(
  parseBranchesCsv(readFileSync(root + BRANCHES_CSV_FILE, "utf8")),
);
export const TZ = "America/Matamoros";
export const GROUP = "120363000000000001@g.us";

/** Config del doctor: su grupo, sus 15 sucursales y lo demás por defecto. */
export function doctorConfig(over: Record<string, unknown> = {}): ApartadorConfig {
  return ApartadorConfigSchema.parse({
    groupJid: GROUP,
    branches: { accepted: DOCTOR_ACCEPTED },
    ...over,
  });
}

export interface FakeState {
  exceptions: Record<string, boolean>;
  activeClaims: string[];
  contacted: string[];
  budgetOk: boolean;
}

/** Contexto de reglas con fuentes en memoria. */
export function ruleContext(
  today: string,
  over: Partial<Omit<RuleContext, "availability" | "claims" | "sendBudget">> = {},
  state: Partial<FakeState> = {},
): RuleContext {
  const s: FakeState = {
    exceptions: {},
    activeClaims: [],
    contacted: [],
    budgetOk: true,
    ...state,
  };
  return {
    config: doctorConfig(),
    status: "active",
    today,
    publisher: {
      jid: "100000000000003@lid",
      phone: "5218990000002",
      lid: "100000000000003",
      name: "Ana",
    },
    canSendToLid: true,
    availability: {
      async exceptions(dates) {
        return new Map(dates.filter((d) => d in s.exceptions).map((d) => [d, s.exceptions[d]!]));
      },
    },
    claims: {
      async activeOn(dates) {
        return new Set(dates.filter((d) => s.activeClaims.includes(d)));
      },
      async contacted(jid, date, shift) {
        return s.contacted.includes(`${jid}|${date}|${shift}`);
      },
    },
    sendBudget: {
      async check() {
        return s.budgetOk ? { ok: true } : { ok: false, reason: "por_hora" };
      },
    },
    ...over,
  };
}
