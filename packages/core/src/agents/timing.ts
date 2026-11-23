import type { Timing } from "./types";

/**
 * Cronómetro por etapa con `performance.now()`. `origin` permite medir desde un instante
 * anterior a la creación (por ejemplo, `receivedAt` del webhook, en ms de `performance.now()`).
 */
export function createTiming(opts: { origin?: number; now?: () => number } = {}): Timing {
  const now = opts.now ?? (() => performance.now());
  const origin = opts.origin ?? now();
  const started = new Map<string, number>();
  const done: Record<string, number> = {};

  const timing: Timing = {
    start(stage) {
      started.set(stage, now());
    },
    end(stage) {
      const t0 = started.get(stage);
      if (t0 === undefined) throw new Error(`timing: la etapa ${stage} no se inició`);
      started.delete(stage);
      const ms = Math.round((now() - t0) * 10) / 10;
      done[stage] = (done[stage] ?? 0) + ms;
      return ms;
    },
    async measure(stage, fn) {
      timing.start(stage);
      try {
        return await fn();
      } finally {
        timing.end(stage);
      }
    },
    elapsed() {
      return Math.round((now() - origin) * 10) / 10;
    },
    snapshot() {
      return { ...done };
    },
  };
  return timing;
}
