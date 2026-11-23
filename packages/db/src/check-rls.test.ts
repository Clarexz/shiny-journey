import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findApiRoleGrants, findTablesWithoutRls, type SqlClient } from "./check-rls";

describe("findTablesWithoutRls (unidad)", () => {
  it("pasa los esquemas como parámetro y devuelve las filas", async () => {
    let captured: unknown[] | undefined;
    const client: SqlClient = {
      async query<R>(_text: string, values?: unknown[]) {
        captured = values;
        return { rows: [{ schema: "public", table: "x" }] as R[] };
      },
    };
    await expect(findTablesWithoutRls(client)).resolves.toEqual([{ schema: "public", table: "x" }]);
    expect(captured).toEqual([["public"]]);
  });
});

// Integración: requiere una base con las migraciones aplicadas (Supabase local o CI).
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("findTablesWithoutRls (integración)", () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  it("las migraciones dejan todas las tablas de public con RLS", async () => {
    await expect(findTablesWithoutRls(client)).resolves.toEqual([]);
  });

  it("anon y authenticated no tienen privilegios en public", async () => {
    await expect(findApiRoleGrants(client)).resolves.toEqual([]);
  });

  it("una tabla nueva tampoco hereda privilegios para anon/authenticated", async () => {
    await client.query("begin");
    try {
      await client.query("create table public.__grants_probe (id int)");
      await client.query("alter table public.__grants_probe enable row level security");
      expect(await findApiRoleGrants(client)).toEqual([]);
      await client.query("grant truncate on public.__grants_probe to anon");
      expect(await findApiRoleGrants(client)).toEqual([
        { schema: "public", table: "__grants_probe", grantee: "anon", privileges: ["TRUNCATE"] },
      ]);
    } finally {
      await client.query("rollback");
    }
  });

  it("detecta una tabla nueva sin RLS (dentro de una transacción que se revierte)", async () => {
    await client.query("begin");
    try {
      await client.query("create table public.__check_rls_probe (id int)");
      expect(await findTablesWithoutRls(client)).toEqual([
        { schema: "public", table: "__check_rls_probe" },
      ]);
      await client.query("alter table public.__check_rls_probe enable row level security");
      expect(await findTablesWithoutRls(client)).toEqual([]);
    } finally {
      await client.query("rollback");
    }
  });
});
