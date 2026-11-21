import { Redis } from "ioredis";

/**
 * Conexión a Redis para BullMQ. `maxRetriesPerRequest: null` es obligatorio para los workers
 * de BullMQ (comandos bloqueantes) y evita que se pierdan comandos durante una reconexión.
 */
export function createRedis(url: string, connectionName: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName,
    lazyConnect: false,
  });
}

export async function pingRedis(redis: Redis, timeoutMs = 1000): Promise<boolean> {
  try {
    const result = await withTimeout(redis.ping(), timeoutMs);
    return result === "PONG";
  } catch {
    return false;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout de ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
