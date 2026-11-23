/**
 * Validación del config contra el catálogo (no cabe en el esquema Zod porque el catálogo vive
 * en la base). La usan el panel al guardar (T1.22) y la activación del módulo (T1.26).
 */
import type { ApartadorConfig } from "../config";
import { aliasConflicts, type BranchCatalog } from "./branch";
import { normalize } from "./normalize";

export interface ConfigCatalogIssue {
  path: string;
  message: string;
}

export function checkConfigAgainstCatalog(
  config: ApartadorConfig,
  catalog: BranchCatalog,
): ConfigCatalogIssue[] {
  const issues: ConfigCatalogIssue[] = [];
  config.branches.accepted.forEach((a, i) => {
    if (a.code === null) return;
    const candidates = catalog.candidates(a.number);
    if (!candidates.some((c) => c.code === a.code)) {
      issues.push({
        path: `branches.accepted.${i}.code`,
        message: `${a.code} no es una sucursal Reynosa ${a.number} del catálogo`,
      });
    }
  });
  for (const c of aliasConflicts(config.branches.accepted, catalog, normalize)) {
    const i = config.branches.accepted.findIndex(
      (a) => a.number === c.number && a.code === c.codes[0],
    );
    issues.push({
      path: `branches.accepted.${i}.aliases`,
      message: `"${c.phrase}" también identifica a otra Reynosa ${c.number} (${c.codes
        .slice(1)
        .map((x) => x ?? "sin clave")
        .join(", ")})`,
    });
  }
  return issues;
}
