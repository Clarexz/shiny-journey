"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@ravyn/db";

/**
 * Cliente de Supabase para el navegador. No se usa en la fase 0 (el login es una Server
 * Action). Queda para la fase 2 (Realtime), cuando haya políticas RLS por tenant.
 * La URL es el propio origen del panel: Supabase no se expone públicamente (plan, 10.3).
 */
export function createClient(anonKey: string, url: string = window.location.origin) {
  return createBrowserClient<Database>(url, anonKey);
}
