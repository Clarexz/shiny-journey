/**
 * Límite de envíos por canal (plan, 6.4): ventana deslizante en Redis (sorted set por canal) y
 * separación mínima entre mensajes a la misma persona.
 *
 * - `check()` solo consulta (regla 16 de 7.7); `tryConsume()` verifica y registra el envío de
 *   forma atómica (script Lua), para que dos trabajos en paralelo no pasen los dos el límite.
 * - Los límites vienen del config de cada agente (`sending.maxPerHour`, `maxPerDay` y
 *   `minGapSameContactMin`).
 */
import type { RateLimitResult, RateLimiter } from "./agents/types";

export interface SendLimits {
  maxPerHour: number;
  maxPerDay: number;
  /** 0 desactiva la separación por contacto. */
  minGapSameContactMin: number;
}

export interface RateLimitInput {
  channelId: string;
  /** Teléfono o JID del destinatario. */
  contact: string;
}

export interface SendRateLimiter extends RateLimiter {
  check(input: RateLimitInput): Promise<RateLimitResult>;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Subconjunto de ioredis que usa el limitador (para no depender de ioredis en core). */
export interface RedisEval {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

// KEYS[1]: sorted set de envíos del canal; KEYS[2]: hora (ms) del último envío al contacto
// (su TTL solo limpia: la comparación usa la hora que se pasa, igual que la ventana).
// ARGV: ahora (ms), maxPorHora, maxPorDía, separación (ms), consumir (1/0), miembro.
const SCRIPT = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - ${DAY_MS})
local last = redis.call('GET', KEYS[2])
if tonumber(ARGV[4]) > 0 and last and now - tonumber(last) < tonumber(ARGV[4]) then return 'mismo_contacto' end
if redis.call('ZCOUNT', KEYS[1], now - ${HOUR_MS}, '+inf') >= tonumber(ARGV[2]) then return 'por_hora' end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 'por_dia' end
if ARGV[5] == '1' then
  redis.call('ZADD', KEYS[1], now, ARGV[6])
  redis.call('PEXPIRE', KEYS[1], ${DAY_MS})
  if tonumber(ARGV[4]) > 0 then redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[4]) end
end
return 'ok'
`;

export function rateLimitKeys(channelId: string, contact: string): [string, string] {
  return [`rl:${channelId}:sends`, `rl:${channelId}:contact:${contact}`];
}

function toResult(raw: unknown): RateLimitResult {
  if (raw === "ok") return { ok: true };
  if (raw === "por_hora" || raw === "por_dia" || raw === "mismo_contacto")
    return { ok: false, reason: raw };
  throw new Error(`rate limit: respuesta inesperada de Redis`);
}

export function createRedisRateLimiter(
  redis: RedisEval,
  limits: SendLimits,
  now: () => number = Date.now,
): SendRateLimiter {
  let seq = 0;
  const run = async ({ channelId, contact }: RateLimitInput, consume: boolean) => {
    const t = now();
    const [sends, contactKey] = rateLimitKeys(channelId, contact);
    const raw = await redis.eval(
      SCRIPT,
      2,
      sends,
      contactKey,
      t,
      limits.maxPerHour,
      limits.maxPerDay,
      limits.minGapSameContactMin * 60_000,
      consume ? "1" : "0",
      `${t}:${process.pid}:${++seq}`,
    );
    return toResult(raw);
  };
  return {
    check: (input) => run(input, false),
    tryConsume: (input) => run(input, true),
  };
}

/** Misma lógica en memoria, para pruebas y para el harness sin Redis. */
export function createMemoryRateLimiter(
  limits: SendLimits,
  now: () => number = Date.now,
): SendRateLimiter {
  const sends = new Map<string, number[]>();
  const lastByContact = new Map<string, number>();
  const run = async (
    { channelId, contact }: RateLimitInput,
    consume: boolean,
  ): Promise<RateLimitResult> => {
    const t = now();
    const list = (sends.get(channelId) ?? []).filter((x) => x > t - DAY_MS);
    sends.set(channelId, list);
    const gap = limits.minGapSameContactMin * 60_000;
    const last = lastByContact.get(`${channelId}|${contact}`);
    if (gap > 0 && last !== undefined && t - last < gap)
      return { ok: false, reason: "mismo_contacto" };
    if (list.filter((x) => x >= t - HOUR_MS).length >= limits.maxPerHour)
      return { ok: false, reason: "por_hora" };
    if (list.length >= limits.maxPerDay) return { ok: false, reason: "por_dia" };
    if (consume) {
      list.push(t);
      lastByContact.set(`${channelId}|${contact}`, t);
    }
    return { ok: true };
  };
  return { check: (i) => run(i, false), tryConsume: (i) => run(i, true) };
}
