/**
 * Extracción y decisión de un mensaje (plan, 6.2 y 7.6): regex, reglas 1 a 3, LLM solo si
 * hace falta, y el resto de las reglas. El pipeline del worker (T1.15) la envuelve con la
 * persistencia, el candado y el envío.
 */
import type { LlmClient } from "@ravyn/core";
import type { AcceptedBranch, BranchCatalog } from "./branch";
import { fmt, localDate } from "./dates";
import { extractDeterministic, type TurnoExtraction } from "./extract";
import { extractWithLlm, shouldCallLlm } from "./llm-extract";
import { earlyDecision, evaluateRules, type RuleContext, type TurnoDecision } from "./rules";

export interface AnalyzeContext extends Omit<RuleContext, "today"> {
  catalog: BranchCatalog;
  timeZone: string;
  /** `null` si no hay LLM configurado: se decide solo con el regex. */
  llm: LlmClient | null;
  llmTimeoutMs?: number;
}

export interface Analysis {
  extraction: TurnoExtraction;
  decision: TurnoDecision;
  llmCalled: boolean;
}

export async function analyze(text: string, now: Date, ctx: AnalyzeContext): Promise<Analysis> {
  const accepted: readonly AcceptedBranch[] = ctx.config.branches.accepted;
  const today = fmt(localDate(now, ctx.timeZone));
  let extraction = extractDeterministic(text, now, {
    catalog: ctx.catalog,
    accepted,
    timeZone: ctx.timeZone,
  });

  const early = earlyDecision(extraction, ctx);
  if (early) return { extraction, decision: early, llmCalled: false };

  let llmCalled = false;
  if (shouldCallLlm(extraction)) {
    if (ctx.llm) {
      llmCalled = true;
      extraction = await extractWithLlm(extraction, text, now, {
        llm: ctx.llm,
        catalog: ctx.catalog,
        accepted,
        timeZone: ctx.timeZone,
        today,
        maxDaysAhead: ctx.config.availability.maxDaysAhead,
        timeoutMs: ctx.llmTimeoutMs,
      });
    }
    // Sin LLM configurado se decide con lo que dio el regex (su confianza manda en la regla 4).
  }

  const decision = await evaluateRules(extraction, { ...ctx, today });
  return { extraction, decision, llmCalled };
}
