/**
 * Esquema de configuración del Apartador de turnos (plan, 7.1) y plantillas iniciales (7.8).
 * Es seguro para el cliente: el panel lo usa con react-hook-form (T1.22).
 */
import { z } from "zod";

export const SHIFTS = ["matutino", "vespertino"] as const;

/** Placeholders permitidos en las plantillas (7.8). */
export const TEMPLATE_PLACEHOLDERS = [
  "{saludo}",
  "{saludo_min}",
  "{, nombre}",
  "{ nombre}",
  "{colonia}",
] as const;

const RE_PLACEHOLDER = /\{[^}]*\}/g;
const RE_URL = /(https?:\/\/|www\.)/i;
const RE_EMOJI = /\p{Extended_Pictographic}/u;

export const TemplateSchema = z
  .object({
    /** Estable: va a `outbound_messages.template_id`. */
    id: z
      .string()
      .regex(/^[a-z0-9_.-]{1,40}$/, "id: minúsculas, números, punto, guion o guion bajo"),
    text: z
      .string()
      .trim()
      .min(5, "plantilla demasiado corta")
      .max(300, "plantilla demasiado larga"),
  })
  .superRefine((t, ctx) => {
    for (const p of t.text.match(RE_PLACEHOLDER) ?? []) {
      if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(p)) {
        ctx.addIssue({ code: "custom", path: ["text"], message: `placeholder desconocido: ${p}` });
      }
    }
    if (RE_URL.test(t.text)) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "sin enlaces" });
    }
    if (RE_EMOJI.test(t.text)) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "sin emojis" });
    }
  });

export type Template = z.infer<typeof TemplateSchema>;

const uniqueIds = (list: Template[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  list.forEach((t, i) => {
    if (seen.has(t.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "id repetido" });
    seen.add(t.id);
  });
};

export const AcceptedBranchSchema = z.object({
  number: z.number().int().positive(),
  /** Clave del catálogo; `null` si solo se conoce el número y la referencia ("Olmo"). */
  code: z
    .string()
    .regex(/^[A-Z]{1,3}-\d{4}$/, "clave inválida")
    .nullable(),
  label: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(3, "alias demasiado corto")).default([]),
});

export const ApartadorConfigSchema = z.object({
  /** Grupo objetivo. `null` hasta que se elige en la pantalla de Conexión (T1.20). */
  groupJid: z
    .string()
    .regex(/@g\.us$/, "debe ser un JID de grupo")
    .nullable()
    .default(null),
  city: z.literal("reynosa").default("reynosa"),

  branches: z
    .object({
      accepted: z.array(AcceptedBranchSchema).default([]),
    })
    .default({ accepted: [] })
    .superRefine((b, ctx) => {
      const seen = new Set<string>();
      b.accepted.forEach((a, i) => {
        const key = `${a.number}:${a.code ?? `null:${a.label.toLowerCase()}`}`;
        if (seen.has(key))
          ctx.addIssue({ code: "custom", path: ["accepted", i], message: "sucursal repetida" });
        seen.add(key);
      });
    }),
  ambiguityPolicy: z.enum(["ask_in_dm", "notify", "claim"]).default("ask_in_dm"),

  shifts: z
    .object({
      allowed: z.array(z.enum(SHIFTS)).min(1).default(["matutino"]),
      bothShiftsRequest: z.enum(["notify", "discard"]).default("discard"),
    })
    .default({ allowed: ["matutino"], bothShiftsRequest: "discard" }),

  availability: z
    .object({
      /** 0 = domingo ... 6 = sábado. */
      weekdays: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
      maxDaysAhead: z.number().int().min(0).max(60).default(21),
      oneShiftPerDay: z.literal(true).default(true),
    })
    .default({ weekdays: [0, 1, 2, 3, 4, 5, 6], maxDaysAhead: 21, oneShiftPerDay: true }),

  multiDayRequest: z.literal("notify").default("notify"),
  minConfidence: z.number().min(0).max(1).default(0.8),

  sending: z
    .object({
      maxPerHour: z.number().int().min(1).max(20).default(6),
      maxPerDay: z.number().int().min(1).max(50).default(15),
      minGapSameContactMin: z.number().int().min(0).default(30),
      targetTotalMs: z.number().int().min(0).max(10_000).default(1800),
      minDelayMs: z.number().int().min(300).default(400),
      maxDelayMs: z.number().int().max(10_000).default(1400),
    })
    .default({
      maxPerHour: 6,
      maxPerDay: 15,
      minGapSameContactMin: 30,
      targetTotalMs: 1800,
      minDelayMs: 400,
      maxDelayMs: 1400,
    })
    .refine((s) => s.maxDelayMs >= s.minDelayMs, {
      message: "maxDelayMs debe ser mayor o igual que minDelayMs",
      path: ["maxDelayMs"],
    }),

  templates: z
    .object({
      interest: z.array(TemplateSchema).min(5, "al menos 5 plantillas").superRefine(uniqueIds),
      interestAmbiguous: z
        .array(
          TemplateSchema.refine((t) => t.text.includes("{colonia}"), {
            message: "debe incluir {colonia}",
            path: ["text"],
          }),
        )
        .min(3, "al menos 3 plantillas")
        .superRefine(uniqueIds),
    })
    .default(() => DEFAULT_TEMPLATES),

  notifyDiscarded: z.boolean().default(false),
  llmMonthlyBudgetUsd: z.number().min(0).default(1),
});

export type ApartadorConfig = z.infer<typeof ApartadorConfigSchema>;
export type AcceptedBranchConfig = z.infer<typeof AcceptedBranchSchema>;

/** Pools iniciales de 7.8. */
export const DEFAULT_TEMPLATES: ApartadorConfig["templates"] = {
  interest: [
    { id: "interest.1", text: "{saludo}, me interesa la cobertura. Yo la puedo cubrir." },
    { id: "interest.2", text: "Hola, {saludo_min}. Me interesa la cobertura, quedo atento." },
    { id: "interest.3", text: "{saludo}{, nombre}. Yo te cubro el turno si sigue disponible." },
    { id: "interest.4", text: "Hola{ nombre}, me interesa cubrir el turno." },
    { id: "interest.5", text: "{saludo}. Puedo cubrir la cobertura, me interesa." },
    { id: "interest.6", text: "Qué tal, {saludo_min}. Me interesa el turno, yo lo cubro." },
    { id: "interest.7", text: "Hola, yo puedo cubrir. Me interesa la cobertura." },
    { id: "interest.8", text: "{saludo}, sigo disponible para la cobertura, me interesa." },
  ],
  interestAmbiguous: [
    { id: "ambiguous.1", text: "{saludo}, me interesa la cobertura. ¿Es la de {colonia}?" },
    { id: "ambiguous.2", text: "Hola, {saludo_min}. Me interesa, ¿es la sucursal de {colonia}?" },
    { id: "ambiguous.3", text: "{saludo}{, nombre}. Yo la puedo cubrir, ¿es la de {colonia}?" },
  ],
};

/** Config por defecto de un tenant nuevo (sin grupo ni sucursales: se configuran en el panel). */
export function defaultApartadorConfig(): ApartadorConfig {
  return ApartadorConfigSchema.parse({});
}
