/**
 * Integración con Supabase local y los usuarios semilla (supabase/seed/dev.sql).
 * Requiere SUPABASE_INTERNAL_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createAdminClient, getTenant, getUserProfile } from "@ravyn/db";
import { resolveTenantContext } from "./resolve";

const url = process.env.SUPABASE_INTERNAL_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceRoleKey);

async function contextFor(email: string) {
  const auth = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await auth.auth.signInWithPassword({ email, password: "ravyn-dev-123" });
  if (error) throw error;
  const db = createAdminClient({ url: url!, serviceRoleKey: serviceRoleKey! });
  return resolveTenantContext({
    async getUser() {
      const { data } = await auth.auth.getUser();
      return data.user ? { id: data.user.id, email: data.user.email } : null;
    },
    loadProfile: (id) => getUserProfile(db, id),
    loadTenant: (id) => getTenant(db, id),
  });
}

describe.skipIf(!enabled)("getTenantContext con usuarios semilla", () => {
  it("tenant_owner obtiene el tenantId de dr-demo", async () => {
    const ctx = await contextFor("owner@example.com");
    expect(ctx?.role).toBe("tenant_owner");
    expect(ctx?.tenantId).toBe("00000000-0000-4000-a000-000000000001");
    expect(ctx?.tenant?.slug).toBe("dr-demo");
  });

  it("ravyn_admin obtiene tenantId null", async () => {
    const ctx = await contextFor("admin@example.com");
    expect(ctx).toMatchObject({ role: "ravyn_admin", tenantId: null, tenant: null });
  });

  it("la anon key no puede leer tablas (RLS deny-all)", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    // eslint-disable-next-line no-restricted-syntax -- la prueba verifica justo el acceso directo
    const { data } = await anon.from("users").select("*");
    expect(data ?? []).toEqual([]);
  });
});
