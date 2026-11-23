/**
 * Resolvedor de sucursal (plan, 0.1 y 7.5).
 *
 * El número de sucursal no es único: casi todos los números del 2 al 38 existen dos veces
 * (series S y F). Se resuelve con el número y las palabras clave de la colonia, y después se
 * evalúa contra las sucursales que acepta el doctor.
 */
import { containsPhrase } from "./normalize";

/** Lo que el resolvedor necesita de `mod_turnos_branches`. */
export interface CatalogBranch {
  code: string;
  number: number;
  keywords: readonly string[];
}

/** Entrada de `config.branches.accepted` (7.1). */
export interface AcceptedBranch {
  number: number;
  /** `null` si solo se conoce el número y la referencia (Reynosa 11 "Olmo"). */
  code: string | null;
  label: string;
  aliases: readonly string[];
}

export type BranchStatus = "resuelta" | "ambigua" | "desconocida";

/**
 * - `aceptada`: se aparta (incluye la ambigua cuyos candidatos son todos aceptados).
 * - `no_aceptada`: regla 2, DESCARTAR.
 * - `mixta`: ambigua con candidatos aceptados y no aceptados; se aplica `ambiguityPolicy` (regla 18).
 * - `desconocida`: el número no está en el catálogo; regla 10, NOTIFICAR.
 */
export type BranchAcceptance = "aceptada" | "no_aceptada" | "mixta" | "desconocida";

export type MatchedBy = "palabra_clave" | "alias" | "unico" | null;

export interface BranchMatch {
  number: number;
  status: BranchStatus;
  /** Código resuelto; `null` si es ambigua, desconocida o una entrada aceptada sin código. */
  code: string | null;
  /** Candidatos del catálogo con ese número. */
  candidates: string[];
  matchedBy: MatchedBy;
  acceptance: BranchAcceptance;
  /** Entrada aceptada que aplica (para la plantilla que pregunta "¿es la de Olmo?"). */
  accepted: AcceptedBranch | null;
}

/** Índice del catálogo por número, con las palabras clave normalizadas. */
export class BranchCatalog {
  private readonly byNumber = new Map<number, CatalogBranch[]>();

  constructor(branches: readonly CatalogBranch[]) {
    for (const b of branches) {
      this.byNumber.set(b.number, [...(this.byNumber.get(b.number) ?? []), b]);
    }
  }

  candidates(number: number): readonly CatalogBranch[] {
    return this.byNumber.get(number) ?? [];
  }

  get size(): number {
    let n = 0;
    for (const list of this.byNumber.values()) n += list.length;
    return n;
  }
}

/** Palabras que identifican una entrada aceptada: su referencia y sus alias, normalizados. */
function acceptedPhrases(entry: AcceptedBranch, norm: (s: string) => string): string[] {
  return [entry.label, ...entry.aliases].map(norm).filter((p) => p.length >= 3);
}

/**
 * Resuelve la sucursal del número `n` en el texto normalizado y la evalúa contra las
 * aceptadas. `norm` es la misma `normalize()` del texto (se inyecta para no acoplar).
 */
export function resolveBranch(
  n: number,
  text: string,
  catalog: BranchCatalog,
  accepted: readonly AcceptedBranch[],
  norm: (s: string) => string,
): BranchMatch {
  const candidates = catalog.candidates(n);
  const codes = candidates.map((c) => c.code);
  const acceptedHere = accepted.filter((a) => a.number === n);

  // Entrada aceptada sin código (Olmo): si el texto la nombra, es suya; si no, siempre es
  // ambigua mixta (7.5), aunque el catálogo tenga uno o dos candidatos.
  const withoutCode = acceptedHere.find((a) => a.code === null);
  if (withoutCode) {
    if (acceptedPhrases(withoutCode, norm).some((p) => containsPhrase(text, p))) {
      return {
        number: n,
        status: "resuelta",
        code: null,
        candidates: codes,
        matchedBy: "alias",
        acceptance: "aceptada",
        accepted: withoutCode,
      };
    }
    return {
      number: n,
      status: candidates.length === 0 ? "desconocida" : "ambigua",
      code: null,
      candidates: codes,
      matchedBy: null,
      acceptance: "mixta",
      accepted: withoutCode,
    };
  }

  if (candidates.length === 0) {
    return {
      number: n,
      status: "desconocida",
      code: null,
      candidates: [],
      matchedBy: null,
      acceptance: "desconocida",
      accepted: null,
    };
  }

  // Palabras de cada candidato: las del catálogo más los alias del doctor para ese código.
  const hits = candidates.filter((c) => {
    const own = acceptedHere.find((a) => a.code === c.code);
    const phrases = [...c.keywords, ...(own ? acceptedPhrases(own, norm) : [])];
    return phrases.some((p) => containsPhrase(text, p));
  });

  let status: BranchStatus;
  let code: string | null = null;
  let matchedBy: MatchedBy = null;
  if (hits.length === 1) {
    status = "resuelta";
    code = hits[0]!.code;
    matchedBy = "palabra_clave";
  } else if (candidates.length === 1) {
    status = "resuelta";
    code = candidates[0]!.code;
    matchedBy = "unico";
  } else {
    status = "ambigua";
  }

  if (status === "resuelta") {
    const entry = acceptedHere.find((a) => a.code === code) ?? null;
    return {
      number: n,
      status,
      code,
      candidates: codes,
      matchedBy,
      acceptance: entry ? "aceptada" : "no_aceptada",
      accepted: entry,
    };
  }

  // Ambigua: si se mencionaron palabras de varios candidatos, solo cuentan esos.
  const pool = hits.length > 1 ? hits : candidates;
  const acceptedCodes = pool.filter((c) => acceptedHere.some((a) => a.code === c.code));
  const acceptance: BranchAcceptance =
    acceptedCodes.length === pool.length
      ? "aceptada"
      : acceptedCodes.length === 0
        ? "no_aceptada"
        : "mixta";
  return {
    number: n,
    status,
    code: null,
    candidates: pool.map((c) => c.code),
    matchedBy: null,
    acceptance,
    accepted:
      acceptedHere.find((a) => a.code !== null && acceptedCodes.some((c) => c.code === a.code)) ??
      null,
  };
}

/**
 * Alias del doctor que chocan con palabras clave de otra sucursal del mismo número (o con
 * los alias de otra entrada aceptada de ese número). Se usa al validar el config: un choque
 * haría que el texto resuelva a la sucursal equivocada.
 */
export function aliasConflicts(
  accepted: readonly AcceptedBranch[],
  catalog: BranchCatalog,
  norm: (s: string) => string,
): Array<{ number: number; phrase: string; codes: Array<string | null> }> {
  const out: Array<{ number: number; phrase: string; codes: Array<string | null> }> = [];
  for (const entry of accepted) {
    for (const phrase of acceptedPhrases(entry, norm)) {
      const clashes: Array<string | null> = [];
      for (const c of catalog.candidates(entry.number)) {
        if (c.code !== entry.code && c.keywords.includes(phrase)) clashes.push(c.code);
      }
      for (const other of accepted) {
        if (
          other !== entry &&
          other.number === entry.number &&
          acceptedPhrases(other, norm).includes(phrase)
        ) {
          clashes.push(other.code);
        }
      }
      if (clashes.length > 0)
        out.push({ number: entry.number, phrase, codes: [entry.code, ...clashes] });
    }
  }
  return out;
}
