import { normalizePhone, parseJid } from "../phone";
import type { ChannelEvent, ChannelStatus, InboundMessage, InboundMessageType } from "../types";
import { resolveSender, type LidLookup } from "./sender";

/**
 * Conversión de webhooks de Evolution API v2 a `ChannelEvent` (plan, 5.3).
 *
 * Solo se procesan `messages.upsert`, `connection.update` y `qrcode.updated`; todo lo demás
 * se devuelve como `ignored`. La función es pura: no registra, no persiste y no lanza.
 * Los motivos de `ignored` nunca incluyen contenido del mensaje.
 */

export interface EvolutionParseContext {
  channelId: string;
  tenantId: string;
  /** Instancia del canal. Si el payload trae otra, se ignora. */
  instance: string | null;
  now: () => Date;
  lidLookup?: LidLookup;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** `MESSAGES_UPSERT` y `messages.upsert` pasan a `messages.upsert`. */
export function normalizeEventName(event: string): string {
  return event.trim().toLowerCase().replace(/_/g, ".");
}

export function parseEvolutionWebhook(raw: unknown, ctx: EvolutionParseContext): ChannelEvent[] {
  if (!isObj(raw)) return [ignored("payload_invalido")];
  const eventName = str(raw.event);
  if (!eventName) return [ignored("payload_invalido")];

  const instance = str(raw.instance);
  if (ctx.instance !== null && instance !== null && instance !== ctx.instance) {
    return [ignored("instancia_distinta")];
  }

  switch (normalizeEventName(eventName)) {
    case "messages.upsert":
      // `sender` del sobre es el JID propio de la instancia (`521...@s.whatsapp.net`).
      return parseMessagesUpsert(raw.data, ctx, str(raw.sender));
    case "connection.update":
      return [parseConnectionUpdate(raw.data)];
    case "qrcode.updated":
      return [parseQrcodeUpdated(raw.data)];
    default:
      return [ignored("evento_no_soportado")];
  }
}

function ignored(reason: string): ChannelEvent {
  return { kind: "ignored", reason };
}

// messages.upsert

function parseMessagesUpsert(
  data: unknown,
  ctx: EvolutionParseContext,
  ownJid: string | null,
): ChannelEvent[] {
  // v2 manda un objeto; algunas versiones mandan un arreglo o `{ messages: [...] }`.
  const items = Array.isArray(data)
    ? data
    : isObj(data) && Array.isArray(data.messages)
      ? data.messages
      : [data];
  if (items.length === 0) return [ignored("payload_invalido")];
  const receivedAt = ctx.now();
  return items.map((item) => parseMessage(item, ctx, receivedAt, ownJid));
}

function parseMessage(
  item: unknown,
  ctx: EvolutionParseContext,
  receivedAt: Date,
  ownJid: string | null,
): ChannelEvent {
  if (!isObj(item) || !isObj(item.key)) return ignored("payload_invalido");
  const key = item.key;
  const remoteJid = str(key.remoteJid);
  const externalId = str(key.id);
  if (!remoteJid || !externalId) return ignored("payload_invalido");

  const chatKind = parseJid(remoteJid).kind;
  if (chatKind === "other") return ignored("chat_no_soportado"); // status@broadcast, newsletters
  const isGroup = chatKind === "group";

  const senderJid = isGroup ? (str(key.participant) ?? str(item.participant)) : remoteJid;
  if (!senderJid) return ignored("payload_invalido");
  const fromMe = key.fromMe === true;
  let sender = resolveSender(senderJid, key, ctx.lidLookup);
  // Mensajes propios (T1.6, v2.3.7): en DM `remoteJid` es el otro participante, y en grupo
  // `key.participant` es el `@lid` propio sin `participantAlt`. El remitente real es la
  // instancia, cuyo JID viene en el sobre del webhook.
  const ownPhone = fromMe ? normalizePhone(ownJid) : null;
  if (ownJid && ownPhone) {
    sender = isGroup
      ? { ...sender, phone: ownPhone, source: "payload_alt" }
      : { jid: ownJid, phone: ownPhone, lid: null, source: "jid" };
  }

  const waTimestamp = parseTimestamp(item.messageTimestamp) ?? receivedAt;
  const { type, text } = extractContent(item.message);

  const message: InboundMessage = {
    provider: "evolution",
    channelId: ctx.channelId,
    tenantId: ctx.tenantId,
    externalId,
    chat: { jid: remoteJid, kind: isGroup ? "group" : "direct" },
    sender: { jid: sender.jid, phone: sender.phone, lid: sender.lid, name: str(item.pushName) },
    fromMe,
    type,
    text,
    waTimestamp,
    receivedAt,
  };
  return { kind: "message", message };
}

/** `messageTimestamp` llega como número, cadena numérica o Long de protobuf (`{ low, high }`). */
export function parseTimestamp(value: unknown): Date | null {
  let seconds: number | null = null;
  if (typeof value === "number") seconds = value;
  else if (typeof value === "string" && /^\d+$/.test(value)) seconds = Number(value);
  else if (isObj(value) && typeof value.low === "number") {
    const high = typeof value.high === "number" ? value.high : 0;
    seconds = high * 2 ** 32 + (value.low >>> 0);
  }
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

const MEDIA_KEYS = [
  "imageMessage",
  "videoMessage",
  "documentMessage",
  "audioMessage",
  "stickerMessage",
  "ptvMessage",
] as const;

const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
] as const;

const SYSTEM_KEYS = ["protocolMessage", "senderKeyDistributionMessage"] as const;

/** Tipo y texto del mensaje (texto plano, texto extendido o caption de media). */
export function extractContent(message: unknown): {
  type: InboundMessageType;
  text: string | null;
} {
  let m = message;
  // Desenvuelve mensajes efímeros, de una sola vista y documentos con caption.
  for (let depth = 0; depth < 4 && isObj(m); depth++) {
    const wrapper = WRAPPER_KEYS.find((k) => isObj((m as Obj)[k]));
    if (!wrapper) break;
    const inner = (m as Obj)[wrapper] as Obj;
    if (!isObj(inner.message)) break;
    m = inner.message;
  }
  if (!isObj(m)) return { type: "other", text: null };

  if (typeof m.conversation === "string") return { type: "text", text: m.conversation };
  if (isObj(m.extendedTextMessage) && typeof m.extendedTextMessage.text === "string") {
    return { type: "text", text: m.extendedTextMessage.text };
  }
  for (const k of MEDIA_KEYS) {
    const media = m[k];
    if (isObj(media)) {
      return { type: "media", text: typeof media.caption === "string" ? media.caption : null };
    }
  }
  if (isObj(m.reactionMessage)) return { type: "reaction", text: null };
  if (SYSTEM_KEYS.some((k) => isObj(m[k]))) return { type: "system", text: null };
  return { type: "other", text: null };
}

// connection.update

/** Estado de Evolution (`open`, `connecting`, `close`, `refused`) al de la plataforma. */
export function mapConnectionState(state: unknown, statusReason?: unknown): ChannelStatus | null {
  switch (state) {
    case "open":
      return "open";
    case "connecting":
      return "connecting";
    case "close":
      // 401: la sesión se cerró desde el teléfono; hay que volver a vincular (5.5).
      return statusReason === 401 || statusReason === "401" ? "logged_out" : "closed";
    case "refused":
      return "error";
    default:
      return null;
  }
}

function parseConnectionUpdate(data: unknown): ChannelEvent {
  if (!isObj(data)) return ignored("payload_invalido");
  const status = mapConnectionState(data.state, data.statusReason);
  if (!status) return ignored("estado_desconocido");
  const detail: Record<string, unknown> = { state: data.state };
  if (data.statusReason !== undefined) detail.statusReason = data.statusReason;
  return { kind: "connection", status, detail };
}

// qrcode.updated

function parseQrcodeUpdated(data: unknown): ChannelEvent {
  if (!isObj(data)) return ignored("payload_invalido");
  const qrcode = isObj(data.qrcode) ? data.qrcode : data;
  const qr = str(qrcode.base64) ?? str(qrcode.code);
  const pairingCode = str(qrcode.pairingCode);
  if (!qr && !pairingCode) return ignored("payload_invalido");
  return { kind: "qr", qr, pairingCode };
}
