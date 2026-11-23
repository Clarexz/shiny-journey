import { describe, expect, it } from "vitest";
import type { ChannelEvent, InboundMessage } from "../types";
import { evolutionFixtures as fx, envelope, upsert } from "./fixtures";
import {
  extractContent,
  mapConnectionState,
  normalizeEventName,
  parseEvolutionWebhook,
  parseTimestamp,
  type EvolutionParseContext,
} from "./parse";

const now = new Date("2026-11-09T15:00:01.000Z");
const ctx = (over: Partial<EvolutionParseContext> = {}): EvolutionParseContext => ({
  channelId: "ch-1",
  tenantId: "t-1",
  instance: "t-demo-1",
  now: () => now,
  ...over,
});

const parse = (raw: unknown, over?: Partial<EvolutionParseContext>) =>
  parseEvolutionWebhook(raw, ctx(over));

function message(events: ChannelEvent[]): InboundMessage {
  expect(events).toHaveLength(1);
  const e = events[0];
  if (e?.kind !== "message") throw new Error(`se esperaba message: ${JSON.stringify(e)}`);
  return e.message;
}

describe("parseEvolutionWebhook: messages.upsert", () => {
  it("grupo: remitente en key.participant", () => {
    const m = message(parse(fx.groupText));
    expect(m).toMatchObject({
      provider: "evolution",
      chat: { kind: "group", jid: "120363000000000001@g.us" },
      sender: { jid: "5218991234567@s.whatsapp.net", phone: "5218991234567", lid: null },
      fromMe: false,
      type: "text",
      receivedAt: now,
    });
  });

  it("grupo: participant en data.participant si no viene en key", () => {
    const raw = upsert({ participant: null });
    (raw.data as Record<string, unknown>).participant = "528991234567@s.whatsapp.net";
    expect(message(parse(raw)).sender.phone).toBe("5218991234567");
  });

  it("grupo sin participante se ignora", () => {
    expect(parse(upsert({ participant: null }))).toEqual([
      { kind: "ignored", reason: "payload_invalido" },
    ]);
  });

  it("DM: remitente en remoteJid", () => {
    const m = message(parse(fx.directText));
    expect(m.chat).toEqual({ jid: "5218997654321@s.whatsapp.net", kind: "direct" });
    expect(m.sender.phone).toBe("5218997654321");
  });

  it("DM desde un @lid con remoteJidAlt", () => {
    const m = message(
      parse(
        upsert({
          remoteJid: "555@lid",
          key: { remoteJidAlt: "528997654321@s.whatsapp.net" },
        }),
      ),
    );
    expect(m.chat.kind).toBe("direct");
    expect(m.sender).toMatchObject({ lid: "555", phone: "5218997654321" });
  });

  it("fromMe", () => {
    expect(message(parse(fx.fromMe)).fromMe).toBe(true);
  });

  it("@lid con campo alterno y sin él", () => {
    expect(message(parse(fx.lidWithPhone)).sender).toMatchObject({
      lid: "123456789012345",
      phone: "5218990001111",
    });
    expect(message(parse(fx.lidWithoutPhone)).sender).toMatchObject({
      lid: "123456789012345",
      phone: null,
    });
    expect(
      message(parse(fx.lidWithoutPhone, { lidLookup: () => "5218990004444" })).sender.phone,
    ).toBe("5218990004444");
  });

  it("media con caption", () => {
    expect(message(parse(fx.mediaWithCaption))).toMatchObject({
      type: "media",
      text: "foto del turno",
    });
  });

  it("ignora status@broadcast y newsletters", () => {
    expect(
      parse(upsert({ remoteJid: "status@broadcast", participant: "1@s.whatsapp.net" })),
    ).toEqual([{ kind: "ignored", reason: "chat_no_soportado" }]);
    expect(parse(upsert({ remoteJid: "1@newsletter" }))[0]).toMatchObject({ kind: "ignored" });
  });

  it("ignora otra instancia", () => {
    expect(parse(fx.groupText, { instance: "t-otro-1" })).toEqual([
      { kind: "ignored", reason: "instancia_distinta" },
    ]);
  });

  it("acepta el nombre del evento en mayúsculas", () => {
    const raw = { ...fx.groupText, event: "MESSAGES_UPSERT" };
    expect(message(parse(raw)).externalId).toBe("CONTRACT-MSG-1");
  });

  it("acepta data como arreglo", () => {
    const raw = { ...fx.groupText, data: [fx.groupText.data, fx.directText.data] };
    const events = parse(raw);
    expect(events.map((e) => e.kind)).toEqual(["message", "message"]);
  });

  it("sin messageTimestamp usa receivedAt", () => {
    const raw = upsert();
    delete (raw.data as Record<string, unknown>).messageTimestamp;
    expect(message(parse(raw)).waTimestamp).toEqual(now);
  });

  it("sin pushName deja name en null", () => {
    expect(message(parse(upsert({ pushName: null }))).sender.name).toBeNull();
  });

  it("eventos no soportados y payloads inválidos se ignoran", () => {
    expect(parse(envelope("contacts.update", {}))).toEqual([
      { kind: "ignored", reason: "evento_no_soportado" },
    ]);
    for (const raw of [null, "x", [], { event: 3 }, envelope("messages.upsert", { key: {} })]) {
      expect(parse(raw).every((e) => e.kind === "ignored")).toBe(true);
    }
  });

  it("los motivos de ignorado no incluyen el texto", () => {
    const raw = upsert({ remoteJid: "status@broadcast", participant: "1@s.whatsapp.net" });
    expect(JSON.stringify(parse(raw))).not.toContain("cobertura");
  });
});

describe("extractContent", () => {
  it.each([
    [{ conversation: "a" }, "text", "a"],
    [{ extendedTextMessage: { text: "b", contextInfo: {} } }, "text", "b"],
    [{ ephemeralMessage: { message: { extendedTextMessage: { text: "c" } } } }, "text", "c"],
    [{ viewOnceMessageV2: { message: { imageMessage: { caption: "d" } } } }, "media", "d"],
    [
      { documentWithCaptionMessage: { message: { documentMessage: { caption: "e" } } } },
      "media",
      "e",
    ],
    [{ audioMessage: { seconds: 3 } }, "media", null],
    [{ stickerMessage: {} }, "media", null],
    [{ reactionMessage: { text: "ok" } }, "reaction", null],
    [{ protocolMessage: { type: 0 } }, "system", null],
    [{ pollCreationMessage: {} }, "other", null],
    [null, "other", null],
  ])("%j -> %s", (msg, type, text) => {
    expect(extractContent(msg)).toEqual({ type, text });
  });
});

describe("connection.update y qrcode.updated", () => {
  it("mapea los estados", () => {
    expect(parse(fx.connectionOpen)).toEqual([
      { kind: "connection", status: "open", detail: { state: "open", statusReason: 200 } },
    ]);
    expect(parse(fx.connectionLoggedOut)[0]).toMatchObject({ status: "logged_out" });
    expect(mapConnectionState("close", 428)).toBe("closed");
    expect(mapConnectionState("connecting")).toBe("connecting");
    expect(mapConnectionState("refused")).toBe("error");
    expect(mapConnectionState("nuevo")).toBeNull();
    expect(parse(envelope("connection.update", { state: "nuevo" }))).toEqual([
      { kind: "ignored", reason: "estado_desconocido" },
    ]);
  });

  it("qrcode.updated trae QR y código de vinculación", () => {
    expect(parse(fx.qrcode)).toEqual([
      { kind: "qr", qr: "data:image/png;base64,iVBORw0KGgo=", pairingCode: "WZYEH1YY" },
    ]);
    expect(parse(envelope("qrcode.updated", { qrcode: { code: "2@x" } }))).toEqual([
      { kind: "qr", qr: "2@x", pairingCode: null },
    ]);
    expect(parse(envelope("qrcode.updated", { qrcode: {} }))[0]?.kind).toBe("ignored");
  });
});

describe("utilidades", () => {
  it("parseTimestamp acepta número, cadena y Long", () => {
    const t = new Date(1_762_700_400_000);
    expect(parseTimestamp(1_762_700_400)).toEqual(t);
    expect(parseTimestamp("1762700400")).toEqual(t);
    expect(parseTimestamp({ low: 1_762_700_400, high: 0, unsigned: true })).toEqual(t);
    expect(parseTimestamp(0)).toBeNull();
    expect(parseTimestamp("ayer")).toBeNull();
  });

  it("normalizeEventName", () => {
    expect(normalizeEventName("CONNECTION_UPDATE")).toBe("connection.update");
    expect(normalizeEventName("qrcode.updated")).toBe("qrcode.updated");
  });
});
