import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../src/pricing";

describe("estimateCostUsd", () => {
  it("cobra los tokens en caché a su tarifa y el razonamiento como salida", () => {
    // 900 de entrada (100 en caché) y 150 de salida con gpt-6-luna.
    expect(
      estimateCostUsd("gpt-6-luna", {
        inputTokens: 900,
        cachedInputTokens: 100,
        outputTokens: 150,
      }),
    ).toBeCloseTo((800 * 0.1 + 100 * 0.01 + 150 * 0.5) / 1e6, 12);
    expect(
      estimateCostUsd("desconocido", { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }),
    ).toBeNull();
  });
});
