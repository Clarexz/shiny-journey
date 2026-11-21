/**
 * Marca como inalcanzable una rama de un switch exhaustivo.
 * Si TypeScript permite llamarla, falta un caso.
 */
export function assertNever(value: never, message = "Valor no esperado"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
