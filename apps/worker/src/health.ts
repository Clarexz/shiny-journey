import type { AdminClient } from "@ravyn/db";
import type { Redis } from "ioredis";
import { pingRedis, withTimeout } from "./redis";

export interface HealthStatus {
  ok: boolean;
  redis: boolean;
  db: boolean;
}

export type HealthCheck = () => Promise<HealthStatus>;

/** Consulta mínima a Postgres vía PostgREST con la service role. */
export async function pingDb(db: AdminClient, timeoutMs = 1500): Promise<boolean> {
  try {
    const { error } = await withTimeout(
      Promise.resolve(db.from("tenants").select("id", { head: true, count: "estimated" }).limit(1)),
      timeoutMs,
    );
    return !error;
  } catch {
    return false;
  }
}

export function createHealthCheck(deps: { redis: Redis; db: AdminClient }): HealthCheck {
  return async () => {
    const [redis, db] = await Promise.all([pingRedis(deps.redis), pingDb(deps.db)]);
    return { ok: redis && db, redis, db };
  };
}
