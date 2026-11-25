import type { LlmClient, LlmResult } from "@ravyn/core";

/**
 * Presupuesto mensual de LLM por tenant (7.6): acumulado en `llm:cost:{tenant}:{yyyymm}`. Si
 * el acumulado ya alcanzó el límite, no se llama al proveedor y la extracción falla con
 * `budget_exhausted` (el caso pasa a NOTIFICAR). El mes es el de UTC.
 */
export interface BudgetStore {
  get(key: string): Promise<number>;
  /** Suma y devuelve el nuevo total. */
  add(key: string, usd: number): Promise<number>;
}

export interface BudgetOptions {
  tenantId: string;
  monthlyLimitUsd: number;
  store: BudgetStore;
  now?: () => Date;
}

export function budgetKey(tenantId: string, at: Date): string {
  const month = `${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  return `llm:cost:${tenantId}:${month}`;
}

export function withBudget(client: LlmClient, opts: BudgetOptions): LlmClient {
  const now = opts.now ?? (() => new Date());
  return {
    async extractJson(input) {
      const key = budgetKey(opts.tenantId, now());
      let spent: number;
      try {
        spent = await opts.store.get(key);
      } catch {
        // Sin Redis no se puede controlar el gasto: se trata como agotado.
        return {
          ok: false,
          reason: "budget_exhausted",
          usage: { used: false, stopReason: "budget_exhausted" },
        };
      }
      if (spent >= opts.monthlyLimitUsd) {
        return {
          ok: false,
          reason: "budget_exhausted",
          usage: { used: false, stopReason: "budget_exhausted" },
        };
      }
      const result = (await client.extractJson(input)) as LlmResult<unknown>;
      const cost = result.usage.costUsd ?? 0;
      if (cost > 0) await opts.store.add(key, cost).catch(() => {});
      return result as never;
    },
  };
}

/** Subconjunto de ioredis que necesita el presupuesto (para no depender de ioredis aquí). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  incrbyfloat(key: string, increment: number): Promise<string>;
  expire(key: string, seconds: number): Promise<number>;
}

/** 40 días: el acumulado de un mes se borra solo. */
const BUDGET_TTL_SECONDS = 40 * 24 * 3600;

export function redisBudgetStore(redis: RedisLike): BudgetStore {
  return {
    async get(key) {
      return Number((await redis.get(key)) ?? 0);
    },
    async add(key, usd) {
      const total = Number(await redis.incrbyfloat(key, usd));
      await redis.expire(key, BUDGET_TTL_SECONDS);
      return total;
    },
  };
}

export function memoryBudgetStore(
  initial: Record<string, number> = {},
): BudgetStore & { data: Record<string, number> } {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return data[key] ?? 0;
    },
    async add(key, usd) {
      data[key] = (data[key] ?? 0) + usd;
      return data[key];
    },
  };
}
