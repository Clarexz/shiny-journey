import { Queue } from "bullmq";
import { CONFIG_CHANGED_CHANNEL } from "@ravyn/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger";
import { createRedis } from "../src/redis";
import { watchConfigChanges } from "../src/routing/config-changes";
import { createRedisInboundSink, dedupeKey } from "../src/webhooks/inbound-sink";
import {
  CHANNEL_ID,
  OTHER_GROUP,
  TARGET_GROUP,
  WEBHOOK_URL,
  buildTestApp,
  directMessage,
  groupMessage,
  snapshot,
} from "./webhook-helpers";

// Integración con Redis real (CI o local). Se salta si no hay REDIS_URL.
const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("webhook con Redis y BullMQ (integración)", () => {
  const redis = REDIS_URL ? createRedis(REDIS_URL, "test-webhook") : undefined;
  const prefix = `test-webhook-${Date.now()}`;
  let queue: Queue;

  beforeAll(async () => {
    queue = new Queue("inbound", { connection: redis!, prefix });
    // BullMQ crea su clave `meta` al inicializar la cola; se espera para no confundirla con
    // una escritura del webhook.
    await queue.waitUntilReady();
    await vi.waitFor(async () => expect(await redis!.exists(`${prefix}:inbound:meta`)).toBe(1));
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    const keys = await redis!.keys(`dedupe:${CHANNEL_ID}:*`);
    if (keys.length) await redis!.del(...keys);
    await redis!.quit();
  });

  it("DM y otro grupo: 0 claves nuevas en Redis y 0 trabajos; el grupo objetivo encola uno", async () => {
    const { app } = await buildTestApp({
      sink: createRedisInboundSink(redis!, queue),
      logLevel: "silent",
    });
    const keysBefore = new Set(await redis!.keys("*"));
    await app.inject({
      method: "POST",
      url: WEBHOOK_URL,
      payload: directMessage("hola doctor", `R-DM-${prefix}`),
    });
    await app.inject({
      method: "POST",
      url: WEBHOOK_URL,
      payload: groupMessage("otro grupo", `R-OG-${prefix}`, OTHER_GROUP),
    });
    const created = (await redis!.keys("*")).filter((k) => !keysBefore.has(k));
    expect(created).toEqual([]);
    expect(await redis!.exists(dedupeKey(CHANNEL_ID, `R-DM-${prefix}`))).toBe(0);

    const target = groupMessage("busco cobertura reynosa 3", `R-T-${prefix}`, TARGET_GROUP);
    await app.inject({ method: "POST", url: WEBHOOK_URL, payload: target });
    await app.inject({ method: "POST", url: WEBHOOK_URL, payload: target });
    const counts = await queue.getJobCounts("prioritized", "waiting");
    expect((counts.prioritized ?? 0) + (counts.waiting ?? 0)).toBe(1);
    expect(await redis!.ttl(dedupeKey(CHANNEL_ID, `R-T-${prefix}`))).toBeGreaterThan(6 * 24 * 3600);
    const [job] = await queue.getJobs(["prioritized", "waiting"]);
    expect(job?.id).toBe(`${CHANNEL_ID}_R-T-${prefix}`);
    await app.close();
  });

  it("responde en menos de 20 ms p95 con 200 requests", async () => {
    const { app } = await buildTestApp({
      sink: createRedisInboundSink(redis!, queue),
      logLevel: "silent",
    });
    // Calentamiento (JIT, conexiones).
    for (let i = 0; i < 20; i++) {
      await app.inject({
        method: "POST",
        url: WEBHOOK_URL,
        payload: groupMessage("x", `W-${i}-${prefix}`),
      });
    }
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      // Mezcla realista: la mayoría son de otros chats (se descartan en memoria).
      const payload =
        i % 4 === 0
          ? groupMessage("busco cobertura reynosa 3", `L-${i}-${prefix}`)
          : directMessage("hola", `L-${i}-${prefix}`);
      const t0 = performance.now();
      const res = await app.inject({ method: "POST", url: WEBHOOK_URL, payload });
      times.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    expect(p95).toBeLessThan(20);
    await app.close();
  });

  it("config:changed recarga la tabla de ruteo sin reiniciar", async () => {
    let groups = [OTHER_GROUP];
    const load = vi.fn(async () => snapshot(groups));
    const { routing } = await buildTestApp({
      sink: createRedisInboundSink(redis!, queue),
      load,
      logLevel: "silent",
    });
    const subscriber = createRedis(REDIS_URL!, "test-sub");
    const stop = await watchConfigChanges({
      subscriber,
      table: routing,
      logger: createLogger({ level: "silent" }),
      intervalMs: 0,
      debounceMs: 10,
    });
    expect(routing.get(CHANNEL_ID)?.groupJids.has(TARGET_GROUP)).toBe(false);
    groups = [TARGET_GROUP];
    await redis!.publish(CONFIG_CHANGED_CHANNEL, JSON.stringify({ agentConfigId: "x" }));
    await vi.waitFor(
      () => expect(routing.get(CHANNEL_ID)?.groupJids.has(TARGET_GROUP)).toBe(true),
      {
        timeout: 2000,
      },
    );
    await stop();
    await subscriber.quit();
  });
});
