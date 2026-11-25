import type { LlmClient } from "@ravyn/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { budgetKey, memoryBudgetStore, redisBudgetStore, withBudget } from "../src/budget";

const input = { schema: z.object({ a: z.number() }), system: "s", user: "u" };
const NOW = () => new Date("2026-11-25T12:00:00Z");

function fakeClient(costUsd: number) {
  const extractJson = vi.fn(async () => ({
    ok: true as const,
    data: { a: 1 },
    usage: { used: true, costUsd },
  }));
  return { extractJson } as unknown as LlmClient & { extractJson: typeof extractJson };
}

describe("withBudget", () => {
  it("acumula el costo por tenant y mes", async () => {
    const store = memoryBudgetStore();
    const llm = withBudget(fakeClient(0.0002), {
      tenantId: "t-1",
      monthlyLimitUsd: 1,
      store,
      now: NOW,
    });
    await llm.extractJson(input);
    await llm.extractJson(input);
    expect(store.data["llm:cost:t-1:202611"]).toBeCloseTo(0.0004, 10);
  });

  it("con el presupuesto agotado no llama al proveedor", async () => {
    const inner = fakeClient(0.0002);
    const store = memoryBudgetStore({ "llm:cost:t-1:202611": 1 });
    const r = await withBudget(inner, {
      tenantId: "t-1",
      monthlyLimitUsd: 1,
      store,
      now: NOW,
    }).extractJson(input);
    expect(r).toEqual({
      ok: false,
      reason: "budget_exhausted",
      usage: { used: false, stopReason: "budget_exhausted" },
    });
    expect(inner.extractJson).not.toHaveBeenCalled();
  });

  it("el mes nuevo empieza en cero y cada tenant tiene su cuenta", async () => {
    const store = memoryBudgetStore({ "llm:cost:t-1:202610": 5, "llm:cost:t-2:202611": 5 });
    const r = await withBudget(fakeClient(0.0002), {
      tenantId: "t-1",
      monthlyLimitUsd: 1,
      store,
      now: NOW,
    }).extractJson(input);
    expect(r.ok).toBe(true);
  });

  it("si no se puede leer el acumulado, se trata como agotado", async () => {
    const inner = fakeClient(0.0002);
    const store = { get: async () => Promise.reject(new Error("redis caído")), add: async () => 0 };
    const r = await withBudget(inner, {
      tenantId: "t-1",
      monthlyLimitUsd: 1,
      store,
      now: NOW,
    }).extractJson(input);
    expect(r).toMatchObject({ ok: false, reason: "budget_exhausted" });
    expect(inner.extractJson).not.toHaveBeenCalled();
  });

  it("budgetKey usa el mes de UTC", () => {
    expect(budgetKey("t", new Date("2026-12-01T03:00:00Z"))).toBe("llm:cost:t:202612");
  });

  it("redisBudgetStore usa INCRBYFLOAT con caducidad", async () => {
    const redis = {
      get: vi.fn(async () => "0.5"),
      incrbyfloat: vi.fn(async () => "0.7"),
      expire: vi.fn(async () => 1),
    };
    const store = redisBudgetStore(redis);
    expect(await store.get("k")).toBe(0.5);
    expect(await store.add("k", 0.2)).toBe(0.7);
    expect(redis.incrbyfloat).toHaveBeenCalledWith("k", 0.2);
    expect(redis.expire).toHaveBeenCalledWith("k", 40 * 24 * 3600);
  });
});
