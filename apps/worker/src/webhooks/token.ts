import { createHash, timingSafeEqual } from "node:crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compara el token de la ruta con `channels.webhook_token_hash` en tiempo constante. Si no hay
 * hash (canal desconocido) se compara igual contra un valor fijo, para no revelar por tiempo
 * qué canales existen.
 */
export function tokenMatches(token: string, expectedHash: string | undefined): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const valid = expectedHash !== undefined && /^[0-9a-f]{64}$/.test(expectedHash);
  const expected = Buffer.from(valid ? expectedHash : "0".repeat(64), "hex");
  return timingSafeEqual(actual, expected) && valid;
}
