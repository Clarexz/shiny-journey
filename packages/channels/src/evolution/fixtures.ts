/**
 * Fixtures sintéticos de webhooks de Evolution API v2 (T1.3). Siguen la forma documentada de
 * `messages.upsert`, `connection.update` y `qrcode.updated`; los reales y anonimizados llegan en
 * T1.6 (`modules/apartador-turnos/fixtures/evolution/`) y corren contra las mismas pruebas.
 *
 * Todos los números y textos son inventados.
 */
import { CONTRACT_DATA as d } from "../testing/adapter-contract";

export const FIXTURE_INSTANCE = "t-demo-1";

type Obj = Record<string, unknown>;

export function envelope(event: string, data: unknown, over: Obj = {}): Obj {
  return {
    event,
    instance: FIXTURE_INSTANCE,
    data,
    destination: "http://worker:3001/webhooks/evolution/ch-1/token",
    date_time: "2026-11-09T09:00:00.512-06:00",
    sender: "5218990000000@s.whatsapp.net",
    server_url: "http://evolution:8080",
    apikey: "instancia-api-key-falsa",
    ...over,
  };
}

export interface UpsertOptions {
  remoteJid?: string;
  participant?: string | null;
  key?: Obj;
  fromMe?: boolean;
  id?: string;
  pushName?: string | null;
  message?: Obj | null;
  messageType?: string;
  messageTimestamp?: unknown;
}

export function upsert(o: UpsertOptions = {}): Obj {
  const remoteJid = o.remoteJid ?? d.groupJid;
  const key: Obj = { remoteJid, fromMe: o.fromMe ?? false, id: o.id ?? d.externalId };
  const participant =
    o.participant === undefined
      ? remoteJid.endsWith("@g.us")
        ? `${d.senderPhone}@s.whatsapp.net`
        : null
      : o.participant;
  if (participant !== null) key.participant = participant;
  Object.assign(key, o.key);
  const data: Obj = {
    key,
    pushName: o.pushName === undefined ? d.senderName : o.pushName,
    message: o.message === undefined ? { conversation: d.text } : o.message,
    messageType: o.messageType ?? "conversation",
    messageTimestamp: o.messageTimestamp ?? d.waTimestampSec,
    instanceId: "00000000-0000-4000-8000-000000000001",
    source: "android",
  };
  return envelope("messages.upsert", data);
}

export const evolutionFixtures = {
  groupText: upsert(),
  directText: upsert({
    remoteJid: `${d.directPhone}@s.whatsapp.net`,
    id: "DM-1",
    message: { conversation: "hola doctor" },
  }),
  fromMe: upsert({ fromMe: true, participant: "5218990000000@s.whatsapp.net" }),
  lidWithPhone: upsert({
    participant: `${d.lid}@lid`,
    key: { participantAlt: `${d.lidPhone}@s.whatsapp.net` },
  }),
  lidWithoutPhone: upsert({ participant: `${d.lid}@lid` }),
  mediaWithCaption: upsert({
    message: { imageMessage: { caption: d.caption, mimetype: "image/jpeg" } },
    messageType: "imageMessage",
  }),
  connectionOpen: envelope("connection.update", {
    instance: FIXTURE_INSTANCE,
    state: "open",
    statusReason: 200,
  }),
  connectionLoggedOut: envelope("connection.update", {
    instance: FIXTURE_INSTANCE,
    state: "close",
    statusReason: 401,
  }),
  qrcode: envelope("qrcode.updated", {
    qrcode: {
      instance: FIXTURE_INSTANCE,
      pairingCode: "WZYEH1YY",
      code: "2@falso,codigo,qr",
      base64: "data:image/png;base64,iVBORw0KGgo=",
    },
  }),
  invalid: { hello: "world" },
};
