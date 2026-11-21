/** Roles de usuario (columna users.role). */
export const ROLES = ["ravyn_admin", "ravyn_ops", "tenant_owner", "tenant_member"] as const;
export type Role = (typeof ROLES)[number];

export const RAVYN_ROLES = ["ravyn_admin", "ravyn_ops"] as const satisfies readonly Role[];
export const TENANT_ROLES = ["tenant_owner", "tenant_member"] as const satisfies readonly Role[];

export type RavynRole = (typeof RAVYN_ROLES)[number];
export type TenantRole = (typeof TENANT_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** El personal de Ravyn no pertenece a ningún tenant (CHECK users_role_tenant_check). */
export function isRavynRole(role: Role): role is RavynRole {
  return (RAVYN_ROLES as readonly string[]).includes(role);
}
