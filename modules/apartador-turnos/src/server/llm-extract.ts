/**
 * Extracción con LLM y combinación con el regex (plan, 7.6).
 *
 * - Solo se llama si el regex no bastó (`needsLlm` o turno desconocido) y las reglas 1 a 3 no
 *   descartaron ya el mensaje (eso lo decide quien llama, con `earlyDecision`).
 * - Lo que el regex resolvió con confianza 1 manda: el LLM solo completa lo que falta. Si lo
 *   contradice en un campo resuelto, la confianza final es `min(conf_llm, 0.5)`.
 * - Fechas del LLM en el pasado o más allá de `maxDaysAhead`: la confianza baja a 0.5 como máximo.
 * - Cualquier falla (timeout, rechazo, presupuesto...) deja la extracción como fallida y la
 *   regla 4 la manda a NOTIFICAR con el motivo en `llmFailure`.
 */
import type { LlmClient } from "@ravyn/core";
import { resolveBranch, type AcceptedBranch, type BranchCatalog } from "./branch";
import type { TurnoExtraction } from "./extract";
import { normalize } from "./normalize";
import { LlmExtractionSchema, SYSTEM_PROMPT, buildUserPrompt } from "./prompt";

export interface LlmExtractContext {
  llm: LlmClient;
  catalog: BranchCatalog;
  accepted: readonly AcceptedBranch[];
  timeZone: string;
  /** Fecha local de hoy (`AAAA-MM-DD`). */
  today: string;
  maxDaysAhead: number;
  timeoutMs?: number;
}

/** El regex no bastó: falta el turno o las fechas no son seguras. */
export function shouldCallLlm(ex: TurnoExtraction): boolean {
  return ex.needsLlm || ex.shift === null;
}

const CONTRADICTION_CAP = 0.5;
const OUT_OF_RANGE_CAP = 0.5;
/**
 * Expresiones de fecha que el regex no reconoce ("la próxima semana", "la otra semana"): las
 * personas las interpretan distinto y el LLM también (en la evaluación del 2026-11-25, "la
 * próxima semana el martes" dicho un jueves dio una vez el martes de dentro de 19 días). Con
 * este tope quedan por debajo de `minConfidence` y van a NOTIFICAR: el doctor decide.
 */
const UNRECOGNIZED_DATE_CAP = 0.7;

function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function extractWithLlm(
  det: TurnoExtraction,
  text: string,
  now: Date,
  ctx: LlmExtractContext,
): Promise<TurnoExtraction> {
  const result = await ctx.llm.extractJson({
    schema: LlmExtractionSchema,
    name: "extraccion_cobertura",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(text, now, ctx.timeZone),
    timeoutMs: ctx.timeoutMs,
  });

  if (!result.ok) {
    return { ...det, failed: true, needsLlm: false, llm: result.usage, llmFailure: result.reason };
  }

  const data = result.data;
  let confidence = data.confianza;
  let contradicts = false;

  // Sucursal: el número siempre sale del regex (el prefiltro lo exige).
  let branches = det.branches;
  let branchNumbers = det.branchNumbers;
  if (data.sucursal.numero !== null) {
    if (branchNumbers.length === 0) {
      branchNumbers = [data.sucursal.numero];
      branches = [
        resolveBranch(data.sucursal.numero, normalize(text), ctx.catalog, ctx.accepted, normalize),
      ];
    } else if (!branchNumbers.includes(data.sucursal.numero)) {
      contradicts = true;
    }
  }

  // Turno: el del regex manda.
  const shift = det.shift ?? data.turno;
  if (det.shift !== null && data.turno !== null && det.shift !== data.turno) contradicts = true;

  // Fechas: las del regex mandan si eran seguras (confianza 1).
  const regexSure = det.confidence === 1 && det.dates.length > 0;
  const llmDates = [...new Set(data.fechas)].sort();
  const dates = regexSure ? det.dates : llmDates;
  if (regexSure && llmDates.length > 0 && llmDates.join() !== det.dates.join()) contradicts = true;

  if (contradicts) confidence = Math.min(confidence, CONTRADICTION_CAP);
  if (det.dateIssues.includes("expresion_no_reconocida"))
    confidence = Math.min(confidence, UNRECOGNIZED_DATE_CAP);
  if (!regexSure) {
    const limit = addDaysIso(ctx.today, ctx.maxDaysAhead);
    if (llmDates.some((d) => d < ctx.today || d > limit))
      confidence = Math.min(confidence, OUT_OF_RANGE_CAP);
  }

  return {
    ...det,
    branchNumbers,
    branches,
    dates,
    shift,
    confidence,
    source: "mixed",
    failed: false,
    needsLlm: false,
    llm: result.usage,
    llmNote: data.nota,
  };
}
