import { lidFromJid, normalizePhone, parseJid } from "../phone";

/**
 * Campos alternos del payload de Evolution que pueden traer el teléfono de un remitente `@lid`,
 * en orden de preferencia (plan, 5.4). Los nombres dependen de la versión de Evolution y Baileys:
 * T1.6 los fija con payloads reales.
 */
export const LID_ALT_FIELDS = [
  "participantAlt",
  "participantPn",
  "senderPn",
  "remoteJidAlt",
] as const;

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
