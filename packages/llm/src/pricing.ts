/**
 * Precios por millón de tokens (USD), tarifa estándar y contexto corto. Fuente: páginas
 * oficiales de precios, revisadas el 2026-11-25. Se actualizan a mano junto con `LLM_MODEL`.
 */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  output: number;
}

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "claude-haiku-5-5": { input: 0.1, cachedInput: 0.01, output: 0.5 },
};

export interface TokenCounts {
  inputTokens: number;
  cachedInputTokens: number;
  /** Incluye los tokens de razonamiento, que se cobran como salida. */
  outputTokens: number;
}

/** Costo en USD, o `null` si el modelo no está en la tabla. */
export function estimateCostUsd(
  model: string,
  t: TokenCounts,
  prices = MODEL_PRICES,
): number | null {
  const p = prices[model];
  if (!p) return null;
  const uncached = Math.max(0, t.inputTokens - t.cachedInputTokens);
  return (
    (uncached * p.input + t.cachedInputTokens * p.cachedInput + t.outputTokens * p.output) /
    1_000_000
  );
}
