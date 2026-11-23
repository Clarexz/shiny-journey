import { describe, expect, it } from "vitest";
import { createTiming } from "./timing";
import { fixedClock } from "./types";

describe("createTiming", () => {
  it("mide etapas, acumula repeticiones y el total desde el origen", async () => {
    let t = 100;
    const timing = createTiming({ origin: 40, now: () => t });
    timing.start("extract");
    t = 103.25;
    expect(timing.end("extract")).toBe(3.3);
    await timing.measure("send", async () => {
      t = 353.25;
    });
    timing.start("extract");
    t = 354.25;
    timing.end("extract");
    expect(timing.snapshot()).toEqual({ extract: 4.3, send: 250 });
    expect(timing.elapsed()).toBe(314.3);
    expect(() => timing.end("nada")).toThrow(/no se inició/);
  });

  it("fixedClock devuelve copias y se puede mover", () => {
    const clock = fixedClock("2026-11-09T15:00:00Z");
    const a = clock.now();
    a.setFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-11-09T15:00:00.000Z");
    clock.set("2026-11-10T00:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });
});
