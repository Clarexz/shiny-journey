import "server-only";
import { z } from "zod";

/**
 * Variables de entorno del servidor web, leídas en tiempo de ejecución.
 * Ninguna es NEXT_PUBLIC_*: las imágenes se construyen una vez en CI y se configuran por
 * entorno, y Next incrusta las NEXT_PUBLIC_* en el build. El navegador no habla con Supabase
 * en la fase 0: el login es una Server Action que corre en el servidor.
 */
const ServerEnvSchema = z.object({
  SUPABASE_INTERNAL_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APP_BASE_URL: z.url().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variables de entorno inválidas o faltantes en web: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}
