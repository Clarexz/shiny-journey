import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getTenant, getUserProfile, type AdminClient } from "@ravyn/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { HttpError } from "./errors";
import { hasModule } from "./guards";
import { resolveTenantContext, type ResolvedTenantContext } from "./resolve";

export interface TenantContext extends ResolvedTenantContext {
  /** Cliente con la sesión del usuario (solo Auth; RLS deny-all no le deja leer tablas). */
  supabase: Awaited<ReturnType<typeof createClient>>;
  /** Cliente admin (service role). Para tablas con tenant_id, usar tenantTable(ctx, ...). */
  db: AdminClient;
}

/**
 * Equivalente a getClinicContext() de ravyn-crm. Devuelve null sin sesión o sin perfil válido.
 * Se memoiza por petición con React cache().
 */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const supabase = await createClient();
  const db = createAdminClient();
  const resolved = await resolveTenantContext({
    async getUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email };
    },
    loadProfile: (userId) => getUserProfile(db, userId),
    loadTenant: (tenantId) => getTenant(db, tenantId),
  });
  return resolved ? { ...resolved, supabase, db } : null;
});

/** Para route handlers: contexto o 401. */
export async function requireTenantContext(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) throw new HttpError(401, "No autorizado");
  return ctx;
}

/** Para layouts y páginas de módulo: 404 si el módulo no está activo. */
export function requireModulePage(ctx: TenantContext, moduleKey: string): void {
  if (!hasModule(ctx, moduleKey)) notFound();
}
