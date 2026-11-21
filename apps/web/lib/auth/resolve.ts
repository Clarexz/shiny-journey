import { isRavynRole, isRole, type Role } from "@ravyn/core";
import type { TenantRecord, UserProfile } from "@ravyn/db";

export interface AuthUser {
  id: string;
  email?: string | undefined;
}

export interface ResolvedTenantContext {
  user: AuthUser;
  profile: UserProfile;
  role: Role;
  /** null para el personal de Ravyn (ravyn_*). */
  tenantId: string | null;
  /** null para el personal de Ravyn. */
  tenant: TenantRecord | null;
}

export interface ResolveDeps {
  getUser(): Promise<AuthUser | null>;
  loadProfile(userId: string): Promise<UserProfile | null>;
  loadTenant(tenantId: string): Promise<TenantRecord | null>;
}

/**
 * Lógica de getTenantContext() sin dependencias de Next: así se prueba con usuarios semilla
 * y con dobles. Devuelve null si no hay sesión, no hay perfil o el perfil es incoherente.
 * El tenantId sale siempre del perfil en base de datos, nunca de la petición.
 */
export async function resolveTenantContext(
  deps: ResolveDeps,
): Promise<ResolvedTenantContext | null> {
  const user = await deps.getUser();
  if (!user) return null;

  const profile = await deps.loadProfile(user.id);
  if (!profile || !isRole(profile.role)) return null;
  const role = profile.role;

  if (isRavynRole(role)) {
    // El CHECK de la tabla lo garantiza; se revalida por si el esquema cambia.
    if (profile.tenant_id !== null) return null;
    return { user, profile, role, tenantId: null, tenant: null };
  }

  if (!profile.tenant_id) return null;
  const tenant = await deps.loadTenant(profile.tenant_id);
  if (!tenant || tenant.status === "offboarding") return null;

  return { user, profile, role, tenantId: tenant.id, tenant };
}
