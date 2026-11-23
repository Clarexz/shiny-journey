import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChannelEvent, InboundMessage } from "../types";
import { parseEvolutionWebhook, type EvolutionParseContext } from "./parse";

/**
 * Fixtures reales de Evolution v2.3.7, capturados en T1.6 y anonimizados
 * (docs/notas/evolution-payloads.md). Números falsos: A (instancia) 5218990000001,
 * B 5218990000002; LID de A 100000000000001 y de B 100000000000003.
 */
const DIR = fileURLToPath(
  new URL("../../../../modules/apartador-turnos/fixtures/evolution/", import.meta.url),
);
const load = (name: string): unknown => JSON.parse(readFileSync(DIR + name, "utf8"));

const A = "5218990000001";
const B = "5218990000002";
const GROUP = "120363000000000001@g.us";
const now = new Date("2026-11-23T01:00:00.000Z");
const ctx: EvolutionParseContext = {
  channelId: "ch-test",
  tenantId: "t-test",
  instance: "ravyn-test",
  now: () => now,
};

const parse = (name: string) => parseEvolutionWebhook(load(name), ctx);

function message(events: ChannelEvent[]): InboundMessage {
  expect(events).toHaveLength(1);
  const e = events[0];
  if (e?.kind !== "message") throw new Error(`se esperaba message: ${JSON.stringify(e)}`);
  return e.message;
}

describe("fixtures reales de Evolution v2.3.7", () => {
  it("todos los webhooks se convierten en un evento sin lanzar", () => {
    const webhooks = readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.startsWith("api-"));
    expect(webhooks.length).toBeGreaterThanOrEqual(10);
    for (const f of webhooks) {
      const events = parse(f);
      expect(events, f).toHaveLength(1);
      expect(events[0]?.kind, f).not.toBe("ignored");
    }
  });

  it("grupo: remitente @lid con el teléfono en key.participantAlt", () => {
    const m = message(parse("group-text-quoted-lid-alt.json"));
    expect(m).toMatchObject({
      externalId: "3EB0FAKE000000000000000000000004",
      chat: { jid: GROUP, kind: "group" },
      sender: { jid: "100000000000003@lid", phone: B, lid: "100000000000003", name: "Persona B" },
      fromMe: false,
      type: "text",
      text: "Prueba: texto 4",
      waTimestamp: new Date(1795406368 * 1000),
    });
  });

  it("grupo: foto con caption y reacción", () => {
    expect(message(parse("group-image-caption-lid-alt.json"))).toMatchObject({
      sender: { phone: B, lid: "100000000000003" },
      type: "media",
      text: "Prueba: foto con caption 5",
    });
    expect(message(parse("group-reaction-lid-alt.json"))).toMatchObject({
      sender: { phone: B },
      type: "reaction",
      text: null,
    });
  });

  it("grupo fromMe: @lid propio sin participantAlt, se resuelve con el sender del sobre", () => {
    expect(message(parse("group-text-fromme-lid-sin-alt.json"))).toMatchObject({
      chat: { kind: "group" },
      sender: { jid: "100000000000001@lid", phone: A, lid: "100000000000001" },
      fromMe: true,
      type: "text",
    });
  });

  it("DM: remoteJid ya trae el teléfono", () => {
    expect(message(parse("dm-text-inbound.json"))).toMatchObject({
      chat: { jid: `${B}@s.whatsapp.net`, kind: "direct" },
      sender: { jid: `${B}@s.whatsapp.net`, phone: B, lid: null },
      fromMe: false,
      type: "text",
    });
  });

  it("DM fromMe: el remitente es la instancia, no el otro participante", () => {
    expect(message(parse("dm-text-fromme.json"))).toMatchObject({
      chat: { jid: `${B}@s.whatsapp.net`, kind: "direct" },
      sender: { jid: `${A}@s.whatsapp.net`, phone: A, lid: null },
      fromMe: true,
    });
    expect(message(parse("dm-sticker-fromme.json"))).toMatchObject({
      sender: { phone: A },
      type: "media",
      text: null,
    });
  });

  it("connection.update y qrcode.updated", () => {
    expect(parse("connection-update-connecting.json")).toEqual([
      {
        kind: "connection",
        status: "connecting",
        detail: { state: "connecting", statusReason: 200 },
      },
    ]);
    expect(parse("connection-update-open.json")).toEqual([
      { kind: "connection", status: "open", detail: { state: "open", statusReason: 200 } },
    ]);
    expect(parse("qrcode-updated.json")).toEqual([
      { kind: "qr", qr: "data:image/png;base64,RkFLRQ==", pairingCode: "FAKE1234" },
    ]);
  });
});
