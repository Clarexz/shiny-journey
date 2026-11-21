import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isPublicPath, loginRedirectPath } from "@/lib/auth/paths";

/**
 * Refresca la sesión de Supabase en cada petición (igual que el middleware de ravyn-crm) y
 * redirige a /login las páginas protegidas sin sesión. Las rutas /api no se redirigen:
 * responden 401 desde su route handler.
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.SUPABASE_INTERNAL_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return new NextResponse("Configuración incompleta", { status: 500 });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() valida el token contra Auth y refresca la sesión si hace falta.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && !isPublicPath(pathname) && !pathname.startsWith("/api/")) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    const next = loginRedirectPath(pathname + search);
    if (next !== "/") target.searchParams.set("next", next);
    return redirectWithCookies(target, response);
  }

  if (user && pathname === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    return redirectWithCookies(target, response);
  }

  return response;
}

function redirectWithCookies(target: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(target);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
