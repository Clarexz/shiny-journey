/**
 * Normalización de números y JIDs de WhatsApp (plan, sección 5.2).
 *
 * Forma canónica de un teléfono: solo dígitos, sin `+` ni sufijo. Para México, siempre con el
 * `1` móvil: `521XXXXXXXXXX` (13 dígitos). Es la forma que se guarda en la base
 * (`channels.phone`, `wa_lid_map.phone`, etc.).
 */

/** Servidores de JID que se reconocen. */
export type JidServer = "s.whatsapp.net" | "c.us" | "lid" | "g.us" | "broadcast" | "newsletter";

export type JidKind = "user" | "lid" | "group" | "other";

export interface ParsedJid {
  /** Parte antes de `@` (y de `:<device>`). */
  user: string;
  /** Dispositivo (`:<n>`), si venía. */
  device: string | null;
  /** `null` si la entrada no traía `@`. */
  server: JidServer | string | null;
  kind: JidKind;
}

const USER_SERVERS = new Set(["s.whatsapp.net", "c.us"]);

const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** Descompone un JID (`521...:3@s.whatsapp.net`, `1234@lid`, `1203...@g.us`) o un número suelto. */
export function parseJid(input: string): ParsedJid {
  const trimmed = input.trim();
  const at = trimmed.lastIndexOf("@");
  const local = at === -1 ? trimmed : trimmed.slice(0, at);
  const server = at === -1 ? null : trimmed.slice(at + 1).toLowerCase();

  const colon = local.indexOf(":");
  const user = colon === -1 ? local : local.slice(0, colon);
  const device = colon === -1 ? null : local.slice(colon + 1) || null;

  let kind: JidKind;
  if (server === null || USER_SERVERS.has(server)) kind = "user";
  else if (server === "lid") kind = "lid";
  else if (server === "g.us") kind = "group";
  else kind = "other";

  return { user, device, server, kind };
}

export function isGroupJid(jid: string): boolean {
  return parseJid(jid).kind === "group";
}

export function isLidJid(jid: string): boolean {
  return parseJid(jid).kind === "lid";
}

export interface NormalizePhoneOptions {
  /**
   * Si se indica `"MX"`, un número de 10 dígitos (sin lada de país) se interpreta como móvil
   * mexicano. Útil para lo que escribe una persona en el panel; nunca para payloads del
   * proveedor, que siempre traen la lada.
   */
  defaultCountry?: "MX";
}

/**
 * Normaliza un teléfono o un JID de usuario a la forma canónica.
 *
 * - Quita `+`, espacios, guiones, puntos y paréntesis, y los sufijos `@s.whatsapp.net`, `@c.us`
 *   y `:<device>`.
 * - México: `52` + 10 dígitos pasa a `521` + 10 dígitos; `521` + 10 dígitos se deja igual.
 * - Devuelve `null` si no es un teléfono: JIDs `@lid`, de grupo, de difusión o con caracteres
 *   que no son dígitos, o una longitud fuera de 8 a 15 dígitos.
 */
export function normalizePhone(
  input: string | null | undefined,
  opts: NormalizePhoneOptions = {},
): string | null {
  if (input == null) return null;
  const parsed = parseJid(input);
  if (parsed.kind !== "user") return null;

  const digits = parsed.user.replace(/[\s+\-.()]/g, "");
  if (!/^\d+$/.test(digits)) return null;

  let phone = digits;
  if (opts.defaultCountry === "MX" && phone.length === 10) phone = `521${phone}`;
  else if (phone.length === 12 && phone.startsWith("52")) phone = `521${phone.slice(2)}`;

  if (phone.length < MIN_DIGITS || phone.length > MAX_DIGITS) return null;
  return phone;
}

/** LID sin sufijo ni dispositivo (`1234:5@lid` pasa a `1234`), o `null` si no es un LID. */
export function lidFromJid(jid: string | null | undefined): string | null {
  if (jid == null) return null;
  const parsed = parseJid(jid);
  if (parsed.kind !== "lid" || !/^\d+$/.test(parsed.user)) return null;
  return parsed.user;
}

export function phoneToJid(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

export function lidToJid(lid: string): string {
  return `${lid}@lid`;
}

/**
 * Variantes de envío para un teléfono canónico, en orden de preferencia. Para México se prueba
 * primero con el `1` y después sin él, si la primera falla con `number_not_found` (5.2).
 */
export function phoneSendVariants(phone: string): string[] {
  if (/^521\d{10}$/.test(phone)) return [phone, `52${phone.slice(3)}`];
  return [phone];
}

/** Compara dos teléfonos o JIDs de usuario por su forma canónica. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  return na !== null && na === normalizePhone(b);
}

/** Versión para logs: deja los primeros 3 y los últimos 4 dígitos (`521******4567`). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  if (phone.length <= 7) return "*".repeat(phone.length);
  return `${phone.slice(0, 3)}${"*".repeat(phone.length - 7)}${phone.slice(-4)}`;
}
