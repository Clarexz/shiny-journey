import type { AdminClient } from "./admin";
import type { Row } from "./tables";

export type UserProfile = Row<"users">;

/**
 * Lee el perfil de un usuario por su id de auth. Es la única consulta a `users` sin filtro de
 * tenant: se usa para descubrir el tenant del usuario autenticado (getTenantContext()).
 */
export async function getUserProfile(db: AdminClient, userId: string): Promise<UserProfile | null> {
  const { data, error } = await db.from("users").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(`getUserProfile: ${error.message}`);
  return data;
}

export type TenantRecord = Row<"tenants">;

/** Lee un tenant por id. `tenants` no tiene tenant_id: su id es el tenant. */
export async function getTenant(db: AdminClient, tenantId: string): Promise<TenantRecord | null> {
  const { data, error } = await db.from("tenants").select("*").eq("id", tenantId).maybeSingle();
  if (error) throw new Error(`getTenant: ${error.message}`);
  return data;
}
