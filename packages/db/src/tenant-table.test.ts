import { describe, expect, it } from "vitest";
import type { AdminClient } from "./admin";
import { tenantTable, TenantScopeError } from "./tenant-table";

type Call = [method: string, ...args: unknown[]];

/** Cliente falso que registra la cadena de llamadas de cada `.from()`. */
function fakeDb() {
  const chains: { table: string; calls: Call[] }[] = [];
  const db = {
    from(table: string) {
      const chain = { table, calls: [] as Call[] };
      chains.push(chain);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "insert", "upsert", "update", "delete", "eq", "order", "limit"]) {
        builder[m] = (...args: unknown[]) => {
          chain.calls.push([m, ...args]);
          return builder;
        };
      }
      return builder;
    },
  };
  return { db: db as unknown as AdminClient, chains };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("tenantTable", () => {
  it("select agrega el filtro de tenant", () => {
    const { db, chains } = fakeDb();
    tenantTable({ db, tenantId: TENANT }, "channels").select("id, status").eq("status", "open");
    expect(chains[0]).toEqual({
      table: "channels",
      calls: [
        ["select", "id, status", undefined],
        ["eq", "tenant_id", TENANT],
        ["eq", "status", "open"],
      ],
    });
  });

  it("update agrega el filtro de tenant", () => {
    const { db, chains } = fakeDb();
    tenantTable({ db, tenantId: TENANT }, "channels").update({ status: "closed" });
    expect(chains[0]?.calls).toEqual([
      ["update", { status: "closed" }],
      ["eq", "tenant_id", TENANT],
    ]);
  });

  it("delete agrega el filtro de tenant", () => {
    const { db, chains } = fakeDb();
    tenantTable({ db, tenantId: TENANT }, "channel_status_events").delete().eq("id", "x");
    expect(chains[0]?.calls).toEqual([["delete"], ["eq", "tenant_id", TENANT], ["eq", "id", "x"]]);
  });

  it("insert inyecta tenant_id en una fila y en varias", () => {
    const { db, chains } = fakeDb();
    const t = tenantTable({ db, tenantId: TENANT }, "audit_log");
    t.insert({ action: "login" });
    t.insert([{ action: "a" }, { action: "b", tenant_id: TENANT }]);
    expect(chains[0]?.calls).toEqual([["insert", { action: "login", tenant_id: TENANT }]]);
    expect(chains[1]?.calls).toEqual([
      [
        "insert",
        [
          { action: "a", tenant_id: TENANT },
          { action: "b", tenant_id: TENANT },
        ],
      ],
    ]);
  });

  it("upsert inyecta tenant_id", () => {
    const { db, chains } = fakeDb();
    tenantTable({ db, tenantId: TENANT }, "audit_log").upsert({ action: "x" });
    expect(chains[0]?.calls).toEqual([["upsert", { action: "x", tenant_id: TENANT }, undefined]]);
  });

  it("insert rechaza un tenant_id distinto", () => {
    const { db } = fakeDb();
    const t = tenantTable({ db, tenantId: TENANT }, "audit_log");
    expect(() => t.insert({ action: "x", tenant_id: OTHER })).toThrow(TenantScopeError);
  });

  it("update no permite mover filas a otro tenant y quita tenant_id del set", () => {
    const { db, chains } = fakeDb();
    const t = tenantTable({ db, tenantId: TENANT }, "channels");
    expect(() => t.update({ tenant_id: OTHER })).toThrow(TenantScopeError);
    t.update({ tenant_id: TENANT, status: "open" });
    expect(chains.at(-1)?.calls[0]).toEqual(["update", { status: "open" }]);
  });

  it("falla sin tenantId en el contexto", () => {
    const { db } = fakeDb();
    expect(() => tenantTable({ db, tenantId: "" }, "channels")).toThrow(TenantScopeError);
    expect(() => tenantTable({ db, tenantId: null as unknown as string }, "channels")).toThrow(
      TenantScopeError,
    );
  });
});
