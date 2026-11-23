// Genera la migración de datos de mod_turnos_branches desde el CSV del anexo A.
//   npm run gen:branches -w @ravyn/module-apartador-turnos
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keywordConflicts, parseBranchesCsv } from "../src/catalog/branches";
import {
  BRANCHES_CSV_FILE,
  BRANCHES_MIGRATION_FILE,
  branchesMigrationSql,
} from "../src/catalog/sql";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const branches = parseBranchesCsv(readFileSync(root + BRANCHES_CSV_FILE, "utf8"));
const conflicts = keywordConflicts(branches);
if (conflicts.length > 0) {
  console.error("Palabras clave repetidas dentro del mismo número:", conflicts);
  process.exit(1);
}
writeFileSync(root + BRANCHES_MIGRATION_FILE, branchesMigrationSql(branches));
console.warn(`${BRANCHES_MIGRATION_FILE}: ${branches.length} sucursales`);
