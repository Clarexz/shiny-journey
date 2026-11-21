import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@ravyn/db";
import { serverEnv } from "@/lib/env";

/**
 * Cliente de Supabase con la sesión del usuario (cookies), para Server Components,
 * Server Actions y route handlers. Usa la anon key: con RLS deny-all no puede leer tablas;
 * solo sirve para Auth. Los datos se leen con el cliente admin y tenantTable().
 */
export async function createClient() {
  // cookies() primero: marca la ruta como dinámica antes de leer el entorno.
  const cookieStore = await cookies();
  const env = serverEnv();
  return createServerClient<Database>(env.SUPABASE_INTERNAL_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Llamado desde un Server Component: no puede escribir cookies. El proxy refresca
          // la sesión en cada petición, así que se puede ignorar.
        }
      },
    },
  });
}
