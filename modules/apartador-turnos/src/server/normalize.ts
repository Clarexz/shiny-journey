/**
 * Normalización del texto antes del regex (plan, 7.2):
 *
 * 1. Minúsculas y sin diacríticos (`mañana` queda `manana`).
 * 2. Sin emojis ni símbolos.
 * 3. Puntos o guiones bajos entre letras pasan a espacio (`solicito.cobertura`, `la.juarez`).
 * 4. Números pegados a letras se separan (`reynosa13`, `15noviembre`).
 * 5. Espacios colapsados.
 *
 * Las comas y los demás signos se conservan: el parser de fechas los usa como conectores.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f/gu, " ")
    .replace(/\p{So}|\p{Sk}/gu, " ")
    .replace(/(?<=\p{L})[._]+(?=\p{L})/gu, " ")
    .replace(/(?<=\p{L})(?=\d)|(?<=\d)(?=\p{L})/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escapa un texto para usarlo dentro de una expresión regular. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `true` si `phrase` (ya normalizada) aparece como palabra o frase completa en `text`. */
export function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase)}(?![a-z0-9])`).test(text);
}
