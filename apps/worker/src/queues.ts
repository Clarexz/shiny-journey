import { Queue, type DefaultJobOptions } from "bullmq";
import type { Redis } from "ioredis";

/**
 * Colas de la plataforma (plan, 6.3). En la fase 0 solo se declaran; los procesadores
 * llegan en la fase 1.
 */
export const QUEUE_NAMES = [
  "inbound",
  "outbound",
  "side-effects",
  "notify",
  "maintenance",
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** Concurrencia de cada procesador (se usa al crear los Worker de BullMQ en la fase 1). */
export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  inbound: 4,
  outbound: 2,
  "side-effects": 4,
  notify: 4,
  maintenance: 1,
};

const keep = {
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/**
 * Reintentos por defecto. Los casos especiales (p. ej. inbound solo reintenta antes de enviar
 * y con menos de 20 s de antigüedad) se deciden en el procesador, no aquí.
 */
export const QUEUE_DEFAULTS: Record<QueueName, DefaultJobOptions> = {
  inbound: { attempts: 2, backoff: { type: "fixed", delay: 0 }, ...keep },
  outbound: { attempts: 3, backoff: { type: "exponential", delay: 1000 }, ...keep },
  "side-effects": { attempts: 5, backoff: { type: "exponential", delay: 1000 }, ...keep },
  notify: { attempts: 3, backoff: { type: "exponential", delay: 1000 }, ...keep },
  maintenance: { attempts: 1, ...keep },
};

export type Queues = Record<QueueName, Queue>;

export function createQueues(connection: Redis, prefix = "ravyn"): Queues {
  const entries = QUEUE_NAMES.map(
    (name) =>
      [
        name,
        new Queue(name, { connection, prefix, defaultJobOptions: QUEUE_DEFAULTS[name] }),
      ] as const,
  );
  return Object.fromEntries(entries) as Queues;
}

export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}
