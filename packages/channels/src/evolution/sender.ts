import { lidFromJid, normalizePhone, parseJid } from "../phone";

/**
 * Campos alternos de `key` que traen el teléfono de un remitente `@lid`, en orden de preferencia
 * (plan, 5.4). Fijados en T1.6 con payloads reales de Evolution v2.3.7 (Baileys 7.0.0-rc.9),
 * ver docs/notas/evolution-payloads.md:
 *
 * - `participantAlt`: en grupos (`addressingMode: "lid"`), `key.participant` es el `@lid` y este
 *   campo trae `521...@s.whatsapp.net`. No llega en los mensajes propios (`fromMe`).
 * - `remoteJidAlt`: en DM. Esta versión ya entrega `remoteJid` con el teléfono y repite el mismo
 *   valor aquí; se conserva por si `remoteJid` llega como `@lid`.
 *
 * `participantPn` y `senderPn` (nombres de Baileys 6.x) no aparecen en esta versión. En un
 * grupo, un `remoteJidAlt` sería del chat y no un teléfono: `normalizePhone` lo descarta.
 * Al cambiar `EVOLUTION_VERSION` hay que volver a validarlos (plan, 10.6).
 */
export const LID_ALT_FIELDS = ["participantAlt", "remoteJidAlt"] as const;

/** Búsqueda síncrona en el mapa LID -> teléfono ya cargado en memoria (`wa_lid_map`). */
export type LidLookup = (lid: string) => string | null;

export type SenderSource = "jid" | "payload_alt" | "lid_map" | "unresolved";

export interface ResolvedSender {
  /** JID tal cual llegó. */
  jid: string;
  phone: string | null;
  lid: string | null;
  source: SenderSource;
}

/**
 * Cascada de resolución del remitente (plan, 5.4), sin red ni efectos:
 *
 * 1. JID de usuario (`@s.whatsapp.net`): se normaliza el teléfono.
 * 2. `@lid`: se busca el teléfono en los campos alternos de `key` (`LID_ALT_FIELDS`).
 * 3. Si no, en el mapa en memoria (`lidLookup`).
 * 4. Si no, se devuelve el LID con `phone = null`; quien llama encola el refresco de participantes.
 *
 * Cuando el resultado trae `phone` y `lid` a la vez (pasos 2 y 3), quien llama puede guardar el
 * par en `wa_lid_map`.
 */
export function resolveSender(
  jid: string,
  key: Record<string, unknown>,
  lidLookup?: LidLookup,
): ResolvedSender {
  const parsed = parseJid(jid);
  if (parsed.kind === "user") {
    return { jid, phone: normalizePhone(jid), lid: null, source: "jid" };
  }

  const lid = lidFromJid(jid);
  if (lid === null) return { jid, phone: null, lid: null, source: "unresolved" };

  for (const field of LID_ALT_FIELDS) {
    const value = key[field];
    if (typeof value !== "string") continue;
    const phone = normalizePhone(value);
    if (phone) return { jid, phone, lid, source: "payload_alt" };
  }

  const mapped = lidLookup?.(lid) ?? null;
  const phone = mapped === null ? null : normalizePhone(mapped);
  if (phone) return { jid, phone, lid, source: "lid_map" };

  return { jid, phone: null, lid, source: "unresolved" };
}
