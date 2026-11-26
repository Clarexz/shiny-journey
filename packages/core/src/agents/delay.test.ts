import { describe, expect, it } from "vitest";
import { adaptiveDelay } from "./delay";

const base = { targetTotalMs: 1800, minDelayMs: 400, maxDelayMs: 1400 };

describe("adaptiveDelay (6.5)", () => {
  it("rellena hasta el objetivo, dentro de mínimo y máximo", () => {
    const mid = () => 0.5; // sin jitter
    expect(adaptiveDelay({ ...base, elapsedMs: 600, random: mid })).toBe(1200);
    expect(adaptiveDelay({ ...base, elapsedMs: 50, random: mid })).toBe(1400);
    // Con LLM ya se gastó mucho: no baja del mínimo.
    expect(adaptiveDelay({ ...base, elapsedMs: 1700, random: mid })).toBe(400);
    expect(adaptiveDelay({ ...base, elapsedMs: 5000, random: mid })).toBe(400);
  });

  it("el jitter es de ±150 ms", () => {
    expect(adaptiveDelay({ ...base, elapsedMs: 800, random: () => 0 })).toBe(850);
    expect(adaptiveDelay({ ...base, elapsedMs: 800, random: () => 0.999999 })).toBe(1150);
  });

  it("en 1000 corridas nunca sale del rango", () => {
    for (let i = 0; i < 1000; i++) {
      const d = adaptiveDelay({ ...base, elapsedMs: Math.random() * 3000 });
      expect(d).toBeGreaterThanOrEqual(400);
      expect(d).toBeLessThanOrEqual(1400);
    }
  });
});
