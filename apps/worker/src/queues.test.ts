import { afterAll, describe, expect, it } from "vitest";
import { createRedis } from "./redis";
import { closeQueues, createQueues, QUEUE_NAMES } from "./queues";

describe("QUEUE_NAMES", () => {
  it("declara las 5 colas del plan", () => {
    expect(QUEUE_NAMES).toEqual(["inbound", "outbound", "side-effects", "notify", "maintenance"]);
  });
});

// Integración con Redis real (Docker o local). Se salta si no hay REDIS_URL.
const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("createQueues (integración)", () => {
  const redis = REDIS_URL ? createRedis(REDIS_URL, "test") : undefined;
  afterAll(async () => {
    await redis?.quit();
  });

  it("crea las colas y acepta trabajos", async () => {
    const prefix = `test-${Date.now()}`;
    const queues = createQueues(redis!, prefix);
    const job = await queues.maintenance.add("noop", { n: 1 });
    expect(job.id).toBeDefined();
    expect(await queues.maintenance.getJobCounts("waiting")).toEqual({ waiting: 1 });
    await Promise.all(Object.values(queues).map((q) => q.obliterate({ force: true })));
    await closeQueues(queues);
  });
});
