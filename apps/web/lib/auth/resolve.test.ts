import { describe, expect, it } from "vitest";
import type { TenantRecord, UserProfile } from "@ravyn/db";
import { resolveTenantContext, type ResolveDeps } from "./resolve";

const TENANT_ID = "00000000-0000-4000-a000-000000000001";

function tenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: TENANT_ID,
    slug: "dr-demo",
    name: "Consultorio",
    status: "active",
    modules_enabled: ["apartador_turnos"],
    config: {},
    timezone: "America/Matamoros",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "u1",
    tenant_id: TENANT_ID,
    full_name: "Doctor",
    role: "tenant_owner",
    email: "owner@example.com",
    created_at: "",
    ...overrides,
  };
}

function deps(p: UserProfile | null, t: TenantRecord | null = tenant()): ResolveDeps {
  return {
    getUser: async () => ({ id: "u1", email: "owner@example.com" }),
    loadProfile: async () => p,
    loadTenant: async (id) => (t && t.id === id ? t : null),
  };
}

describe("resolveTenantContext", () => {
  it("sin sesión devuelve null", async () => {
    await expect(
      resolveTenantContext({ ...deps(profile()), getUser: async () => null }),
    ).resolves.toBeNull();
  });

  it("sin perfil devuelve null", async () => {
    await expect(resolveTenantContext(deps(null))).resolves.toBeNull();
  });

  it("usuario de tenant: tenantId sale del perfil", async () => {
    const ctx = await resolveTenantContext(deps(profile()));
    expect(ctx?.tenantId).toBe(TENANT_ID);
    expect(ctx?.role).toBe("tenant_owner");
    expect(ctx?.tenant?.slug).toBe("dr-demo");
  });

  it("personal de Ravyn: tenantId null", async () => {
    const ctx = await resolveTenantContext(deps(profile({ role: "ravyn_admin", tenant_id: null })));
    expect(ctx).toMatchObject({ role: "ravyn_admin", tenantId: null, tenant: null });
  });

  it("perfil incoherente o tenant dado de baja devuelve null", async () => {
    await expect(
      resolveTenantContext(deps(profile({ role: "ravyn_ops", tenant_id: TENANT_ID }))),
    ).resolves.toBeNull();
    await expect(resolveTenantContext(deps(profile({ tenant_id: null })))).resolves.toBeNull();
    await expect(resolveTenantContext(deps(profile({ role: "otro" })))).resolves.toBeNull();
    await expect(
      resolveTenantContext(deps(profile(), tenant({ status: "offboarding" }))),
    ).resolves.toBeNull();
  });
});
