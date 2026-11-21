/** Rutas accesibles sin sesión. */
const PUBLIC_PATHS = ["/login"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Sanea el destino posterior al login: solo rutas internas relativas. Evita redirecciones
 * abiertas (`//evil.com`, `https://...`, `/\evil.com`).
 */
export function loginRedirectPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  if (isPublicPath(next.split("?")[0] ?? "")) return "/";
  return next;
}
