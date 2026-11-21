import { describe, expect, it } from "vitest";
import tenantTablesForLint from "@ravyn/config/tenant-tables.json";
import { TENANT_TABLES } from "./tables";

describe("TENANT_TABLES", () => {
  it("coincide con la lista que usa la regla de ESLint", () => {
    expect([...tenantTablesForLint].sort()).toEqual([...TENANT_TABLES].sort());
  });
});
