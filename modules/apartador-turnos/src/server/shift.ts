/** Turno pedido (plan, 7.3). */
export type Shift = "matutino" | "vespertino" | "ambos";

export const RE_TURNO = {
  ambos:
    /\b(ambos\s+turnos|los\s+dos\s+turnos|turno\s+completo|todo\s+el\s+dia|matutino\s+y\s+vespertino|vespertino\s+y\s+matutino)\b/,
  matutino:
    /\b(matutino|turno\s+de\s+(la\s+)?manana|en\s+la\s+manana|por\s+la\s+manana|de\s+la\s+manana)\b/,
  vespertino:
    /\b(vespertino|turno\s+de\s+(la\s+)?tarde|en\s+la\s+tarde|por\s+la\s+tarde|de\s+la\s+tarde)\b/,
};

/**
 * `ambos` tiene prioridad; matutino y vespertino a la vez también cuentan como ambos. Sin
 * ninguno, `null`. El texto ya debe venir normalizado.
 *
 * Nota: "de la tarde" o "por la tarde" también pueden ser solo la hora del saludo ("buenas
 * tardes" no cuenta: no lleva "de la" ni "por la"); el LLM revisa los casos con baja confianza.
 */
export function extractShift(normalized: string): Shift | null {
  if (RE_TURNO.ambos.test(normalized)) return "ambos";
  const m = RE_TURNO.matutino.test(normalized);
  const v = RE_TURNO.vespertino.test(normalized);
  if (m && v) return "ambos";
  if (m) return "matutino";
  if (v) return "vespertino";
  return null;
}
