import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../config";
import {
  fill,
  firstName,
  greeting,
  memoryRecentTemplates,
  pickTemplate,
  redisRecentTemplates,
  renderTemplate,
  TemplateError,
  type RecentTemplates,
} from "./templates";

const TZ = "America/Matamoros";
const at = (local: string) => new Date(`${local}-06:00`);

/** Generador pseudoaleatorio con semilla (mulberry32), para pruebas reproducibles. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function generate(
  n: number,
  recent: RecentTemplates,
  seed = 1,
  pool: "interest" | "interestAmbiguous" = "interest",
) {
  const random = seeded(seed);
  const out: Array<{ templateId: string; text: string }> = [];
  for (let i = 0; i < n; i++) {
    out.push(
      await renderTemplate({
        pool,
        templates: DEFAULT_TEMPLATES[pool],
        channelId: "ch-1",
        now: at(`2026-11-12T${String(6 + (i % 17)).padStart(2, "0")}:15:00`),
        timeZone: TZ,
        publisherName: i % 2 ? "Ana Sofía Pérez" : "🌟 Dra. Lupita",
        colonia: "Cumbres",
        recent,
        random,
      }),
    );
  }
  return out;
}

describe("renderTemplate (7.8)", () => {
  it("100 generaciones: ninguna repite una de las últimas 3 ni deja placeholders", async () => {
    const out = await generate(100, memoryRecentTemplates());
    out.forEach((r, i) => {
      const last3 = out.slice(Math.max(0, i - 3), i).map((x) => x.templateId);
      expect(last3, `generación ${i}`).not.toContain(r.templateId);
      expect(r.text).not.toMatch(/[{}]/);
      expect(r.text).not.toMatch(/\s{2}|\s,|^\s|\s$/);
      expect(r.text).not.toMatch(/https?:|www\./);
      expect(r.text).not.toMatch(/\p{Extended_Pictographic}/u);
    });
    // Usa variedad: al menos 6 de las 8 plantillas.
    expect(new Set(out.map((r) => r.templateId)).size).toBeGreaterThanOrEqual(6);
  });

  it("con el pool ambiguo de 3 plantillas no repite las últimas 2 y siempre pregunta por la referencia", async () => {
    const out = await generate(30, memoryRecentTemplates(), 7, "interestAmbiguous");
    out.forEach((r, i) => {
      expect(out.slice(Math.max(0, i - 2), i).map((x) => x.templateId)).not.toContain(r.templateId);
      expect(r.text).toContain("Cumbres");
    });
  });

  it("la plantilla ambigua sin referencia es un error", async () => {
    await expect(
      renderTemplate({
        pool: "interestAmbiguous",
        templates: DEFAULT_TEMPLATES.interestAmbiguous,
        channelId: "ch",
        now: at("2026-11-12T08:00:00"),
        timeZone: TZ,
        publisherName: null,
        recent: memoryRecentTemplates(),
      }),
    ).rejects.toBeInstanceOf(TemplateError);
  });

  it("usa el nombre de pila en una parte de los casos y nunca nombres raros", async () => {
    const out = await generate(200, memoryRecentTemplates(), 3);
    const withName = out.filter((r) => r.text.includes("Ana")).length;
    expect(withName).toBeGreaterThan(0);
    expect(withName).toBeLessThan(80);
    expect(out.some((r) => /Lupita|Dra/.test(r.text))).toBe(false);
  });
});

describe("greeting", () => {
  it("depende de la hora local, con horario de verano", () => {
    expect(greeting(at("2026-11-12T07:40:00"), TZ)).toBe("Buenos días");
    expect(greeting(at("2026-11-12T11:59:00"), TZ)).toBe("Buenos días");
    expect(greeting(at("2026-11-12T12:00:00"), TZ)).toBe("Buenas tardes");
    expect(greeting(at("2026-11-12T18:59:00"), TZ)).toBe("Buenas tardes");
    expect(["Buenas noches", "Buenas"]).toContain(greeting(at("2026-11-12T19:00:00"), TZ));
    expect(["Buenas noches", "Buenas"]).toContain(greeting(at("2026-11-12T02:00:00"), TZ));
    // 17:30 UTC en julio son las 12:30 en Matamoros (CDT, UTC-5): tardes. Con -6 fijo serían las 11:30.
    expect(greeting(new Date("2026-07-10T17:30:00Z"), TZ)).toBe("Buenas tardes");
  });
});

describe("piezas", () => {
  it("firstName", () => {
    expect(firstName("ana sofía pérez")).toBe("Ana");
    expect(firstName("JOSÉ")).toBe("José");
    expect(firstName("Dra. Lupita")).toBeNull();
    expect(firstName("🌟 Lupita")).toBeNull();
    expect(firstName("A")).toBeNull();
    expect(firstName("x".repeat(21))).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  it("fill rellena y aplica variaciones", () => {
    const values = { saludo: "Buenos días", nombre: "Ana", colonia: "Cumbres" };
    const always = () => 0; // todas las variaciones activas
    const never = () => 0.99;
    expect(fill("{saludo}, me interesa la cobertura.", values, never)).toBe(
      "Buenos días, me interesa la cobertura.",
    );
    expect(fill("{saludo}, me interesa la cobertura.", values, always)).toBe(
      "Buenos días me interesa la cobertura",
    );
    expect(fill("Hola{ nombre}, me interesa.", values, always)).toBe("hola Ana, me interesa");
    expect(fill("{saludo}{, nombre}. Yo te cubro.", { ...values, nombre: null }, never)).toBe(
      "Buenos días. Yo te cubro.",
    );
    expect(fill("Hola, {saludo_min}. ¿Es la de {colonia}?", values, always)).toBe(
      "hola, buenos días. ¿Es la de Cumbres?",
    );
    expect(() => fill("Hola {doctor}", values, never)).toThrow(TemplateError);
  });

  it("pickTemplate siempre deja al menos una opción", () => {
    const t = [{ id: "a", text: "x" }];
    expect(pickTemplate(t, ["a"]).id).toBe("a");
    expect(() => pickTemplate([], [])).toThrow(TemplateError);
  });
});

const REDIS_URL = process.env.REDIS_URL;
const redis = REDIS_URL ? new Redis(REDIS_URL) : null;
afterAll(async () => {
  if (!redis) return;
  await redis.del("tpl:recent:ch-1:interest", "tpl:recent:ch-1:interestAmbiguous");
  await redis.quit();
});

describe.skipIf(!redis)("redisRecentTemplates (integración)", () => {
  it("guarda solo las últimas 3, con caducidad, y cumple lo mismo que en memoria", async () => {
    await redis!.del("tpl:recent:ch-1:interest");
    const store = redisRecentTemplates(redis!);
    const out = await generate(20, store, 5);
    out.forEach((r, i) => {
      expect(out.slice(Math.max(0, i - 3), i).map((x) => x.templateId)).not.toContain(r.templateId);
    });
    expect(await redis!.llen("tpl:recent:ch-1:interest")).toBe(3);
    expect(await redis!.ttl("tpl:recent:ch-1:interest")).toBeGreaterThan(0);
  });
});
