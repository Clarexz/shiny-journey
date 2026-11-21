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
