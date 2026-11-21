import { describe, expect, it } from "vitest";
import type { HttpError } from "./errors";
import { hasModule, requireModule, requireRole } from "./guards";
import type { ResolvedTenantContext } from "./resolve";

const base = {
  user: { id: "u1" },
  profile: {} as ResolvedTenantContext["profile"],
};

const owner: ResolvedTenantContext = {
  ...base,
  role: "tenant_owner",
  tenantId: "t1",
  tenant: { modules_enabled: ["apartador_turnos"] } as unknown as ResolvedTenantContext["tenant"],
};

const staff: ResolvedTenantContext = { ...base, role: "ravyn_admin", tenantId: null, tenant: null };

describe("guards", () => {
  it("requireRole deja pasar roles permitidos y lanza 403 en otros", () => {
    expect(() => requireRole(owner, ["tenant_owner", "tenant_member"])).not.toThrow();
    expect(() => requireRole(owner, ["ravyn_admin"])).toThrow(
      expect.objectContaining({ status: 403 }) as HttpError,
    );
  });

  it("requireModule lanza 404 si el módulo no está activo o no hay tenant", () => {
    expect(hasModule(owner, "apartador_turnos")).toBe(true);
    expect(() => requireModule(owner, "apartador_turnos")).not.toThrow();
    expect(() => requireModule(owner, "otro")).toThrow(
      expect.objectContaining({ status: 404 }) as HttpError,
    );
    expect(() => requireModule(staff, "apartador_turnos")).toThrow(
      expect.objectContaining({ status: 404 }) as HttpError,
    );
  });
});
