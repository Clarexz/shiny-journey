/**
 * Verifica que todas las tablas de public tengan RLS activado. Sale con código 1 si no.
 *
 *   npm run check-rls                          # Supabase local
 *   DATABASE_URL=postgres://... npm run check-rls
 *   npm run check-rls -- --db-url postgres://...
 */
import pg from "pg";
import { findTablesWithoutRls } from "../src/check-rls";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function dbUrlFromArgs(argv: string[]): string | undefined {
  const i = argv.indexOf("--db-url");
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const connectionString = dbUrlFromArgs(process.argv) ?? process.env.DATABASE_URL ?? LOCAL_DB_URL;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const missing = await findTablesWithoutRls(client);
    if (missing.length > 0) {
      console.error("check-rls: tablas sin RLS activado:");
      for (const t of missing) console.error(`  - ${t.schema}.${t.table}`);
      return 1;
    }
    process.stdout.write("check-rls: todas las tablas de public tienen RLS activado\n");
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error("check-rls: error", err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
