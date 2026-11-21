import type { Role } from "@ravyn/core";
import { HttpError } from "./errors";
import type { ResolvedTenantContext } from "./resolve";

/** Lanza 403 si el rol del contexto no está en la lista. */
export function requireRole(ctx: ResolvedTenantContext, roles: readonly Role[]): void {
  if (!roles.includes(ctx.role)) throw new HttpError(403, "Sin permiso");
}

/**
 * ¿El tenant del contexto tiene activo el módulo? El personal de Ravyn (sin tenant) no
 * entra a las rutas de módulo del panel del cliente: usa el panel interno.
 */
export function hasModule(ctx: ResolvedTenantContext, moduleKey: string): boolean {
  return ctx.tenant?.modules_enabled.includes(moduleKey) ?? false;
}

/**
 * Lanza 404 (no 403, para no revelar qué módulos existen) si el módulo no está activo.
 * En layouts y páginas, usar requireModulePage(), que llama a notFound().
 */
export function requireModule(ctx: ResolvedTenantContext, moduleKey: string): void {
  if (!hasModule(ctx, moduleKey)) throw new HttpError(404, "No encontrado");
}
