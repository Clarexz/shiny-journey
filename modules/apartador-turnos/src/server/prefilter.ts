/**
 * Prefiltro (plan, 7.3): barato y síncrono. Solo los mensajes que lo pasan se persisten y
 * siguen por el pipeline; el resto se descarta sin dejar rastro.
 *
 * Extensión sobre el plan: además de "cobertura" se aceptan "coberturas" y las formas de
 * "cubrir" ("alguien que me cubra", "quien me cubre"), porque un falso negativo aquí es una
 * oportunidad perdida que nadie ve. Lo que pase de más lo filtran las reglas.
 */
export const RE_COBERTURA = /\b(coberturas?|cubrir|cubra|cubran|cubre|cubren)\b/;
export const RE_SUCURSAL = /\breynosa\s*(\d{1,3})\b/g;

/** Números de sucursal mencionados, sin repetir y en orden de aparición. */
export function extractBranchNumbers(normalized: string): number[] {
  const out: number[] = [];
  for (const m of normalized.matchAll(RE_SUCURSAL)) {
    const n = Number(m[1]);
    if (n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** El texto ya debe venir normalizado (`normalize`). */
export function prefilter(normalized: string): boolean {
  return RE_COBERTURA.test(normalized) && extractBranchNumbers(normalized).length > 0;
}
