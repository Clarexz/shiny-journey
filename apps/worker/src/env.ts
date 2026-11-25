import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

/**
 * Variables de entorno del worker (plan, 10.4). En la fase 0 solo son obligatorias las de
 * Supabase y Redis; las de Evolution, LLM, push, correo y Telegram se vuelven obligatorias
 * en la tarea de la fase 1 que las usa.
 */
export const WorkerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  SUPABASE_INTERNAL_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.url().refine((u) => u.startsWith("redis://") || u.startsWith("rediss://"), {
    message: "debe empezar con redis:// o rediss://",
  }),

  EVOLUTION_BASE_URL: z.url().optional(),
  EVOLUTION_API_KEY: optionalString,
  WEBHOOK_BASE_URL: z.url().optional(),
  WORKER_INTERNAL_TOKEN: optionalString,
  // LLM del extractor (7.6). Por ahora solo OpenAI; ANTHROPIC_API_KEY queda para un segundo
  // adaptador. Sin key, el Apartador decide solo con el regex.
  LLM_PROVIDER: z.enum(["openai"]).default("openai"),
  OPENAI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  LLM_MODEL: z.string().default("gpt-6-luna"),
  LLM_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).default("none"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_OPS_CHAT_ID: optionalString,
  ACTION_TOKEN_PEPPER: optionalString,
  CHANNEL_DRY_RUN: bool,
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export class EnvError extends Error {
  override name = "EnvError";
}

/** Valida el entorno. El mensaje nombra las variables con problema, nunca sus valores. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = WorkerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new EnvError(`Variables de entorno inválidas:\n  - ${issues.join("\n  - ")}`);
  }
  return parsed.data;
}
