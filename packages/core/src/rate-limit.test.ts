import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  rateLimitKeys,
  type SendLimits,
  type SendRateLimiter,
} from "./rate-limit";

const LIMITS: SendLimits = { maxPerHour: 6, maxPerDay: 15, minGapSameContactMin: 30 };
const MIN = 60_000;

type Factory = (
  limits: SendLimits,
  now: () => number,
  channelId: string,
) => Promise<SendRateLimiter>;

/** Misma batería para la versión en memoria y la de Redis. */
function suite(name: string, make: Factory) {
  describe(`limitador de envíos (${name})`, () => {
    let n = 0;
    const setup = async (limits = LIMITS) => {
      const clock = { t: Date.UTC(2026, 10, 12, 15, 0, 0) };
      const channelId = `ch-${name}-${Date.now()}-${++n}`;
      const limiter = await make(limits, () => clock.t, channelId);
      const send = (contact: string) => limiter.tryConsume({ channelId, contact });
      return { clock, channelId, limiter, send };
    };

    it("permite hasta maxPerHour y luego corta por hora", async () => {
      const { send, clock } = await setup();
      for (let i = 0; i < 6; i++) {
        expect(await send(`c${i}`)).toEqual({ ok: true });
        clock.t += MIN;
      }
      expect(await send("c7")).toEqual({ ok: false, reason: "por_hora" });
      // La ventana se desliza: una hora después del primero, vuelve a haber cupo.
      clock.t += 55 * MIN;
      expect(await send("c8")).toEqual({ ok: true });
    });

    it("corta por día aunque haya cupo por hora", async () => {
      const { send, clock } = await setup();
      for (let i = 0; i < 15; i++) {
        expect((await send(`c${i}`)).ok).toBe(true);
        clock.t += 61 * MIN;
      }
      expect(await send("c16")).toEqual({ ok: false, reason: "por_dia" });
      clock.t += 10 * 61 * MIN; // pasan 24 h desde los primeros
      expect((await send("c17")).ok).toBe(true);
    });

    it("no le escribe dos veces seguidas a la misma persona", async () => {
      const { send, clock } = await setup();
      expect((await send("5218990000002")).ok).toBe(true);
      clock.t += 29 * MIN;
      expect(await send("5218990000002")).toEqual({ ok: false, reason: "mismo_contacto" });
      expect((await send("5218990000003")).ok).toBe(true);
      clock.t += 2 * MIN;
      expect((await send("5218990000002")).ok).toBe(true);
    });

    it("check() consulta sin consumir", async () => {
      const { limiter, channelId, send } = await setup({ ...LIMITS, maxPerHour: 1 });
      for (let i = 0; i < 3; i++)
        expect(await limiter.check({ channelId, contact: "a" })).toEqual({ ok: true });
      expect((await send("a")).ok).toBe(true);
      expect(await limiter.check({ channelId, contact: "b" })).toEqual({
        ok: false,
        reason: "por_hora",
      });
    });

    it("los canales no comparten cupo", async () => {
      const { clock } = await setup();
      const stamp = `${Date.now()}-${++n}`;
      const limiter = await make({ ...LIMITS, maxPerHour: 1 }, () => clock.t, "");
      expect(
        (await limiter.tryConsume({ channelId: `ch-${name}-a-${stamp}`, contact: "1" })).ok,
      ).toBe(true);
      expect(
        (await limiter.tryConsume({ channelId: `ch-${name}-b-${stamp}`, contact: "1" })).ok,
      ).toBe(true);
      expect(
        (await limiter.tryConsume({ channelId: `ch-${name}-a-${stamp}`, contact: "2" })).ok,
      ).toBe(false);
    });

    it("con minGapSameContactMin = 0 no aplica la separación", async () => {
      const { send } = await setup({ ...LIMITS, minGapSameContactMin: 0 });
      expect((await send("a")).ok).toBe(true);
      expect((await send("a")).ok).toBe(true);
    });
  });
}

suite("memoria", async (limits, now) => createMemoryRateLimiter(limits, now));

// Integración con Redis real (CI o local). Se salta si no hay REDIS_URL.
const REDIS_URL = process.env.REDIS_URL;
const redis = REDIS_URL ? new Redis(REDIS_URL, { lazyConnect: false }) : null;
afterAll(async () => {
  if (!redis) return;
  const keys = await redis.keys("rl:ch-redis-*");
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

describe.skipIf(!redis)("con Redis", () => {
  suite("redis", async (limits, now) => createRedisRateLimiter(redis!, limits, now));

  it("tryConsume es atómico: 20 en paralelo con cupo 6 dejan pasar exactamente 6", async () => {
    const channelId = `ch-redis-par-${Date.now()}`;
    const limiter = createRedisRateLimiter(redis!, { ...LIMITS, minGapSameContactMin: 0 });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => limiter.tryConsume({ channelId, contact: `c${i}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(6);
    const [sends] = rateLimitKeys(channelId, "x");
    expect(await redis!.zcard(sends)).toBe(6);
    expect(await redis!.pttl(sends)).toBeGreaterThan(0);
  });
});
