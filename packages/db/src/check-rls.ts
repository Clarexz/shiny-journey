/** Cliente mínimo: lo cumple `pg.Client` y `pg.Pool`, y una implementación falsa en pruebas. */
export interface SqlClient {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

export interface TableWithoutRls {
  schema: string;
  table: string;
}

/**
 * Tablas (normales y particionadas) de los esquemas dados que no tienen RLS activado.
 * Debe devolver una lista vacía: con la anon key pública, una tabla sin RLS es legible y
 * escribible por PostgREST sin pasar por la aplicación (plan, 11.1).
 */
export async function findTablesWithoutRls(
  client: SqlClient,
  schemas: readonly string[] = ["public"],
): Promise<TableWithoutRls[]> {
  const { rows } = await client.query<TableWithoutRls>(
    `select n.nspname as schema, c.relname as "table"
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[])
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity
      order by 1, 2`,
    [schemas],
  );
  return rows;
}

export interface ApiRoleGrant {
  schema: string;
  table: string;
  grantee: string;
  privileges: string[];
}

/** Roles de la API de Supabase que usan las claves públicas o las sesiones del navegador. */
export const API_ROLES = ["anon", "authenticated"] as const;

/**
 * Tablas donde anon o authenticated tienen algún privilegio. Debe devolver una lista vacía:
 * RLS no cubre TRUNCATE, REFERENCES ni TRIGGER, así que el deny-all de la fase 0 también
 * exige quitar los grants (migración 202611230000_revoke_api_roles).
 */
export async function findApiRoleGrants(
  client: SqlClient,
  schemas: readonly string[] = ["public"],
  roles: readonly string[] = API_ROLES,
): Promise<ApiRoleGrant[]> {
  const { rows } = await client.query<ApiRoleGrant>(
    `select table_schema as schema, table_name as "table", grantee,
            array_agg(privilege_type::text order by privilege_type) as privileges
       from information_schema.role_table_grants
      where table_schema = any($1::text[])
        and grantee = any($2::text[])
      group by 1, 2, 3
      order by 1, 2, 3`,
    [schemas, roles],
  );
  return rows;
}
