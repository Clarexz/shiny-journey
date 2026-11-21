import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.gen";

export type AdminClient = SupabaseClient<Database>;

export interface AdminClientOptions {
  /** URL de Kong. En el VPS es la interna (`http://supabase-kong:8000`). */
  url: string;
  /** Service role key. Ignora RLS: solo existe en el servidor. */
  serviceRoleKey: string;
}

/**
 * Cliente de Supabase con la service role, igual que `lib/supabase/admin.ts` de ravyn-crm.
 * No persiste sesión ni refresca tokens: es un cliente de servidor sin usuario.
 */
export function createAdminClient({ url, serviceRoleKey }: AdminClientOptions): AdminClient {
  if (!url) throw new Error("createAdminClient: falta la URL de Supabase");
  if (!serviceRoleKey) throw new Error("createAdminClient: falta la service role key");
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
