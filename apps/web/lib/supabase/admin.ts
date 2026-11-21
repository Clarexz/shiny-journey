import "server-only";
import { createAdminClient as createDbAdminClient, type AdminClient } from "@ravyn/db";
import { serverEnv } from "@/lib/env";

let cached: AdminClient | undefined;

/** Cliente con service role (ignora RLS). Solo en el servidor. */
export function createAdminClient(): AdminClient {
  if (cached) return cached;
  const env = serverEnv();
  cached = createDbAdminClient({
    url: env.SUPABASE_INTERNAL_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return cached;
}
