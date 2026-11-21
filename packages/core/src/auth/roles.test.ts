import { describe, expect, it } from "vitest";
import { isRavynRole, isRole } from "./roles";

describe("roles", () => {
  it("isRole reconoce solo los roles válidos", () => {
    expect(isRole("tenant_owner")).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("isRavynRole distingue personal de Ravyn", () => {
    expect(isRavynRole("ravyn_admin")).toBe(true);
    expect(isRavynRole("ravyn_ops")).toBe(true);
    expect(isRavynRole("tenant_member")).toBe(false);
  });
});
