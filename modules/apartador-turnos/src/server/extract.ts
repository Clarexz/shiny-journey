/**
 * Extracción determinista (regex y parser de fechas), el camino rápido de 6.2. T1.13 la
 * combina con el LLM cuando `needsLlm` es verdadero.
 */
import type { LlmFailureReason, LlmUsage } from "@ravyn/core";
import type { AcceptedBranch, BranchCatalog, BranchMatch } from "./branch";
import { resolveBranch } from "./branch";
import { parseDates, type DateIssue } from "./dates";
import { normalize } from "./normalize";
import { extractBranchNumbers } from "./prefilter";
import { extractShift, type Shift } from "./shift";

export interface TurnoExtraction {
  /** Números de sucursal mencionados (todos). */
  branchNumbers: number[];
  /** Resolución de cada número, en el mismo orden. */
  branches: BranchMatch[];
  dates: string[];
  shift: Shift | null;
  /** De 0 a 1. Hoy es la confianza de las fechas; el LLM da la suya en T1.13. */
  confidence: number;
  source: "regex" | "llm" | "mixed";
  /** La extracción falló por completo (timeout del LLM, error, etc.). */
  failed: boolean;
  needsLlm: boolean;
  dateIssues: DateIssue[];
  /** Uso del LLM, si se llamó (va a `agent_events.llm`). */
  llm?: LlmUsage;
  /** Motivo de la falla del LLM (`timeout`, `refusal`, `budget_exhausted`...). */
  llmFailure?: LlmFailureReason;
  /** Nota del LLM cuando baja la confianza (sin texto del mensaje). */
  llmNote?: string | null;
}

export interface ExtractContext {
  catalog: BranchCatalog;
  accepted: readonly AcceptedBranch[];
  timeZone: string;
}

export function extractDeterministic(
  text: string,
  now: Date,
  ctx: ExtractContext,
): TurnoExtraction {
  const normalized = normalize(text);
  const branchNumbers = extractBranchNumbers(normalized);
  const branches = branchNumbers.map((n) =>
    resolveBranch(n, normalized, ctx.catalog, ctx.accepted, normalize),
  );
  const dates = parseDates(normalized, now, ctx.timeZone);
  return {
    branchNumbers,
    branches,
    dates: dates.dates,
    shift: extractShift(normalized),
    confidence: dates.confidence,
    source: "regex",
    failed: false,
    needsLlm: dates.requiresLlm,
    dateIssues: dates.issues,
  };
}
