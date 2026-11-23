import type { Branch } from "./branches";

export const BRANCHES_MIGRATION_FILE =
  "supabase/migrations/202611240200_mod_turnos_branches_data.sql";
export const BRANCHES_CSV_FILE = "docs/anexos/sucursales-reynosa.csv";

const lit = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
const arr = (xs: string[]) =>
  xs.length === 0 ? "'{}'::text[]" : `array[${xs.map((x) => lit(x)).join(", ")}]::text[]`;

/**
 * Migración de datos del catálogo. Es idempotente (`on conflict do update`): una migración
 * posterior con el catálogo corregido se genera igual y actualiza las filas existentes.
 */
export function branchesMigrationSql(branches: Branch[]): string {
  const values = branches
    .map(
      (b) =>
        `  (${lit(b.code)}, ${lit(b.city)}, ${lit(b.series)}, ${b.number}, ${lit(b.officialName)}, ` +
        `${lit(b.colonia)}, ${lit(b.cp)}, ${lit(b.address)}, ${arr(b.keywords)})`,
    )
    .join(",\n");
  return `-- Catálogo de sucursales de Reynosa (T1.9): ${branches.length} filas.
-- ARCHIVO GENERADO: no editar a mano. Fuente: ${BRANCHES_CSV_FILE} y
-- modules/apartador-turnos/src/catalog/branches.ts (palabras clave de 7.5).
-- Regenerar con: npm run gen:branches -w @ravyn/module-apartador-turnos
-- Va como migración (no como semilla) porque el catálogo también se necesita en producción.

insert into public.mod_turnos_branches
  (code, city, series, number, official_name, colonia, cp, address, keywords)
values
${values}
on conflict (code) do update set
  city = excluded.city,
  series = excluded.series,
  number = excluded.number,
  official_name = excluded.official_name,
  colonia = excluded.colonia,
  cp = excluded.cp,
  address = excluded.address,
  keywords = excluded.keywords;
`;
}
