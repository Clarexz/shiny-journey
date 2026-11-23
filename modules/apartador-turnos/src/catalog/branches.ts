/**
 * Catálogo de sucursales de Reynosa (plan, 0.1, 7.5 y anexo A; T1.9).
 *
 * Fuente: `docs/anexos/sucursales-reynosa.csv` (85 sucursales de los PDF del doctor). Las
 * palabras clave salen de la colonia (`deriveKeywords`) más los ajustes manuales de la tabla
 * de 7.5 (`MANUAL_KEYWORDS`). `scripts/gen-branches-migration.ts` escribe con esto la
 * migración de datos de `mod_turnos_branches`; una prueba verifica que no se desincronice.
 *
 * Es un catálogo global: los alias propios de cada doctor (por ejemplo, Reynosa 11 "Olmo", que
 * no tiene código) viven en el config del tenant, no aquí.
 */

export interface BranchCsvRow {
  clave: string;
  serie: string;
  numero: string;
  nombre_oficial: string;
  colonia: string;
  cp: string;
  direccion: string;
}

export interface Branch {
  code: string;
  city: "reynosa";
  series: "S" | "F";
  number: number;
  officialName: string;
  colonia: string;
  cp: string | null;
  address: string;
  keywords: string[];
}

/**
 * Normalización de palabras clave: minúsculas, sin acentos (la ñ pasa a n) y todo lo que no
 * sea letra o dígito se vuelve espacio. Misma regla base que `normalize()` del texto (7.2).
 */
export function normalizeKeyword(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Ajustes manuales de 7.5 (sucursales de la lista del doctor), por código. */
export const MANUAL_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "S-0202": ["heron", "heron ramirez", "rodriguez"],
  "S-0219": ["centro", "porfirio diaz"],
  "S-0404": ["cumbres", "mil cumbres"],
  "S-0414": ["hidalgo", "del valle"],
  "S-0805": ["centro", "colon"],
  "S-1430": ["vista hermosa", "vistahermosa"],
  "S-1607": ["puerta del sol", "puerto madero"],
  "S-1858": ["aquiles", "aquiles serdan"],
  "F-0651": ["jarachina", "jarachinas", "las lomas"],
  "F-4224": ["caracoles"],
  "S-2266": ["hacienda del sol"],
  "F-4706": ["petrolera", "escandon"],
  "F-6477": ["jarachina sur", "tecnologico"],
  "F-7456": ["vista alta"],
};

/** Palabras que aparecen en casi cualquier mensaje y no distinguen nada. */
const USELESS = new Set(["reynosa", "tamaulipas", "tms", "centro reynosa"]);

const PREFIXES = /^(fraccionamiento|fracc|colonia|col|unidad habitacional)\s+/;
const ARTICLES = /^(la|las|el|los)\s+/;
// Sufijos que no distinguen: numerales romanos y listas de secciones ("la canada 1 2").
const SUFFIXES = /(\s+(i|ii|iii|iv|[0-9]+))+$/;

/**
 * Palabras clave derivadas de la colonia: la colonia completa sin prefijos genéricos, sin el
 * artículo inicial, el contenido de paréntesis por separado y sin "reynosa" al inicio
 * ("REYNOSA CENTRO" da "centro").
 */
export function deriveKeywords(colonia: string): string[] {
  const out = new Set<string>();
  const parts: string[] = [];
  const paren = colonia.match(/\(([^)]*)\)/);
  if (paren?.[1]) parts.push(paren[1]);
  parts.push(colonia.replace(/\([^)]*\)/g, " "));

  for (const part of parts) {
    let k = normalizeKeyword(part).replace(PREFIXES, "").replace(SUFFIXES, "");
    k = k.replace(/^reynosa\s+/, "");
    if (!k) continue;
    out.add(k);
    const noArticle = k.replace(ARTICLES, "");
    if (noArticle.length >= 4) out.add(noArticle);
  }
  return [...out].filter((k) => k.length >= 3 && !USELESS.has(k));
}

export function buildBranch(row: BranchCsvRow): Branch {
  if (row.serie !== "S" && row.serie !== "F") {
    throw new Error(`${row.clave}: serie inválida ${row.serie}`);
  }
  const number = Number(row.numero);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${row.clave}: número inválido ${row.numero}`);
  }
  const manual = (MANUAL_KEYWORDS[row.clave] ?? []).map(normalizeKeyword);
  const keywords = [...new Set([...deriveKeywords(row.colonia), ...manual])].sort();
  return {
    code: row.clave,
    city: "reynosa",
    series: row.serie,
    number,
    officialName: row.nombre_oficial,
    colonia: row.colonia,
    cp: /^\d{5}$/.test(row.cp) ? row.cp : null,
    address: row.direccion,
    keywords,
  };
}

/** Parser de CSV mínimo (RFC 4180: comillas dobles y comillas escapadas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseBranchesCsv(text: string): Branch[] {
  const [header, ...rows] = parseCsv(text);
  const expected = ["clave", "serie", "numero", "nombre_oficial", "colonia", "cp", "direccion"];
  if (!header || header.join(",") !== expected.join(",")) {
    throw new Error(`Encabezado inesperado en el CSV de sucursales: ${header?.join(",")}`);
  }
  const branches = rows.map((r, i) => {
    if (r.length !== expected.length) throw new Error(`Fila ${i + 2}: ${r.length} columnas`);
    const obj = Object.fromEntries(
      expected.map((k, j) => [k, r[j] ?? ""]),
    ) as unknown as BranchCsvRow;
    return buildBranch(obj);
  });
  const codes = new Set<string>();
  for (const b of branches) {
    if (codes.has(b.code)) throw new Error(`Código repetido: ${b.code}`);
    codes.add(b.code);
  }
  for (const code of Object.keys(MANUAL_KEYWORDS)) {
    if (!codes.has(code)) throw new Error(`MANUAL_KEYWORDS tiene un código que no existe: ${code}`);
  }
  return branches;
}

/**
 * Palabras clave que comparten dos sucursales del mismo número (el número filtra primero, así
 * que solo ahí hay conflicto; 7.5). Debe quedar vacío.
 */
export function keywordConflicts(
  branches: Branch[],
): Array<{ number: number; keyword: string; codes: string[] }> {
  const byNumber = new Map<number, Branch[]>();
  for (const b of branches) byNumber.set(b.number, [...(byNumber.get(b.number) ?? []), b]);
  const out: Array<{ number: number; keyword: string; codes: string[] }> = [];
  for (const [number, list] of byNumber) {
    const owners = new Map<string, string[]>();
    for (const b of list)
      for (const k of b.keywords) owners.set(k, [...(owners.get(k) ?? []), b.code]);
    for (const [keyword, codes] of owners)
      if (codes.length > 1) out.push({ number, keyword, codes });
  }
  return out;
}
