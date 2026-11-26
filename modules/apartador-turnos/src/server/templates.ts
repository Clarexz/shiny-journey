/**
 * Plantillas del DM (plan, 7.8): saludo según la hora local, variaciones menores y sin repetir
 * ninguna de las últimas 3 usadas en el canal.
 *
 * Placeholders: {saludo} ("Buenos días"), {saludo_min} ("buenos días"), {, nombre} (", Ana" o
 * nada), { nombre} (" Ana" o nada) y {colonia} (la referencia de la sucursal aceptada).
 */
import type { Template } from "../config";

export type TemplatePool = "interest" | "interestAmbiguous";

/** Últimas plantillas usadas por canal y pool (Redis en producción). */
export interface RecentTemplates {
  recent(channelId: string, pool: TemplatePool): Promise<string[]>;
  push(channelId: string, pool: TemplatePool, templateId: string): Promise<void>;
}

export const RECENT_TEMPLATES_KEEP = 3;

export interface RenderInput {
  pool: TemplatePool;
  templates: readonly Template[];
  channelId: string;
  now: Date;
  timeZone: string;
  /** `pushName` del publicador. */
  publisherName: string | null;
  /** Para {colonia}. Obligatorio en el pool `interestAmbiguous`. */
  colonia?: string | null;
  recent: RecentTemplates;
  /** [0, 1). */
  random?: () => number;
}

export interface Rendered {
  templateId: string;
  text: string;
}

export class TemplateError extends Error {
  override name = "TemplateError";
}

/** Saludo por hora local: días antes de 12, tardes de 12 a 19 y noches (o "Buenas") después. */
export function greeting(now: Date, timeZone: string, random: () => number = Math.random): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 19) return "Buenas tardes";
  return random() < 0.5 ? "Buenas noches" : "Buenas";
}

/** Nombre de pila si `pushName` parece un nombre: solo letras, de 2 a 20 caracteres. */
export function firstName(pushName: string | null): string | null {
  if (!pushName) return null;
  const first = pushName.trim().split(/\s+/)[0] ?? "";
  if (!/^\p{L}{2,20}$/u.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Elige una plantilla al azar excluyendo las recientes (siempre queda al menos una). */
export function pickTemplate(
  templates: readonly Template[],
  recent: readonly string[],
  random: () => number = Math.random,
): Template {
  if (templates.length === 0) throw new TemplateError("pool de plantillas vacío");
  const exclude = new Set(recent.slice(0, Math.min(RECENT_TEMPLATES_KEEP, templates.length - 1)));
  const options = templates.filter((t) => !exclude.has(t.id));
  return options[Math.floor(random() * options.length)]!;
}

/** Sustituye placeholders y aplica las variaciones menores de 7.8. */
export function fill(
  text: string,
  values: { saludo: string; nombre: string | null; colonia: string | null },
  random: () => number = Math.random,
): string {
  let out = text;
  // Variación: con o sin coma después del saludo.
  if (random() < 0.5) out = out.replace(/\{saludo\},/, "{saludo}");
  out = out
    .replace(/\{saludo\}/g, values.saludo)
    .replace(/\{saludo_min\}/g, values.saludo.toLowerCase())
    .replace(/\{, nombre\}/g, values.nombre ? `, ${values.nombre}` : "")
    .replace(/\{ nombre\}/g, values.nombre ? ` ${values.nombre}` : "")
    .replace(/\{colonia\}/g, values.colonia ?? "");
  // Variación: "hola" con o sin mayúscula al inicio.
  if (/^Hola\b/.test(out) && random() < 0.3) out = `h${out.slice(1)}`;
  // Variación: punto final opcional (nunca quita signos de interrogación).
  if (out.endsWith(".") && random() < 0.4) out = out.slice(0, -1);
  out = out
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/[{}]/.test(out)) throw new TemplateError("quedó un placeholder sin rellenar");
  return out;
}

export async function renderTemplate(input: RenderInput): Promise<Rendered> {
  const random = input.random ?? Math.random;
  if (input.pool === "interestAmbiguous" && !input.colonia) {
    throw new TemplateError("la plantilla ambigua necesita la referencia de la sucursal");
  }
  const recent = await input.recent.recent(input.channelId, input.pool);
  const template = pickTemplate(input.templates, recent, random);
  // 30 % de las veces se usa el nombre de pila, si parece un nombre.
  const name = random() < 0.3 ? firstName(input.publisherName) : null;
  const text = fill(
    template.text,
    {
      saludo: greeting(input.now, input.timeZone, random),
      nombre: name,
      colonia: input.colonia ?? null,
    },
    random,
  );
  await input.recent.push(input.channelId, input.pool, template.id);
  return { templateId: template.id, text };
}

/** Subconjunto de ioredis que usa el registro de recientes. */
export interface RedisList {
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<number>;
}

export function redisRecentTemplates(redis: RedisList): RecentTemplates {
  const key = (channelId: string, pool: TemplatePool) => `tpl:recent:${channelId}:${pool}`;
  return {
    async recent(channelId, pool) {
      return redis.lrange(key(channelId, pool), 0, RECENT_TEMPLATES_KEEP - 1);
    },
    async push(channelId, pool, templateId) {
      const k = key(channelId, pool);
      await redis.lpush(k, templateId);
      await redis.ltrim(k, 0, RECENT_TEMPLATES_KEEP - 1);
      await redis.expire(k, 30 * 24 * 3600);
    },
  };
}

export function memoryRecentTemplates(): RecentTemplates & { data: Map<string, string[]> } {
  const data = new Map<string, string[]>();
  return {
    data,
    async recent(channelId, pool) {
      return (data.get(`${channelId}:${pool}`) ?? []).slice(0, RECENT_TEMPLATES_KEEP);
    },
    async push(channelId, pool, templateId) {
      const k = `${channelId}:${pool}`;
      data.set(k, [templateId, ...(data.get(k) ?? [])].slice(0, RECENT_TEMPLATES_KEEP));
    },
  };
}
