/**
 * Retraso humano adaptativo (plan, 6.5): el "escribiendo..." antes de enviar.
 *
 *   delay = clamp(objetivo - transcurrido + jitter, mínimo, máximo)
 *
 * Si ya se gastó tiempo (por ejemplo, en el LLM), el retraso baja solo. Nunca baja del mínimo
 * (un humano no responde en menos de 400 ms) ni sube del máximo.
 */
export interface DelayOptions {
  targetTotalMs: number;
  elapsedMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  /** ± ms aleatorios (por defecto 150). */
  jitterMs?: number;
  /** [0, 1). */
  random?: () => number;
}

export function adaptiveDelay(o: DelayOptions): number {
  const jitter = o.jitterMs ?? 150;
  const random = o.random ?? Math.random;
  const raw = o.targetTotalMs - o.elapsedMs + (random() * 2 - 1) * jitter;
  return Math.round(Math.min(o.maxDelayMs, Math.max(o.minDelayMs, raw)));
}
