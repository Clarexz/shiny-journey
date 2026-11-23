import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { inboundJobId, type InboundJobData } from "./inbound-job";

/** Lo que el webhook necesita para pasar un mensaje suscrito al pipeline. */
export interface InboundSink {
  /** `true` si el mensaje es nuevo (primera vez que se ve ese id en el canal). */
  claim(channelId: string, externalId: string): Promise<boolean>;
  enqueue(data: InboundJobData): Promise<void>;
  /** Deshace `claim` (si el encolado falló). */
  release(channelId: string, externalId: string): Promise<void>;
}

/** 7 días (plan, 6.1 y 11.4). */
export const DEDUPE_TTL_SECONDS = 7 * 24 * 3600;

export function dedupeKey(channelId: string, externalId: string): string {
  return `dedupe:${channelId}:${externalId}`;
}

export function createRedisInboundSink(redis: Redis, inbound: Queue): InboundSink {
  return {
    async claim(channelId, externalId) {
      const res = await redis.set(
        dedupeKey(channelId, externalId),
        "1",
        "EX",
        DEDUPE_TTL_SECONDS,
        "NX",
      );
      return res === "OK";
    },
    async release(channelId, externalId) {
      await redis.del(dedupeKey(channelId, externalId));
    },
    async enqueue(data) {
      const { channelId, externalId } = data.message;
      // Prioridad 1 es la más alta en BullMQ.
      await inbound.add("message", data, {
        jobId: inboundJobId(channelId, externalId),
        priority: 1,
      });
    },
  };
}
