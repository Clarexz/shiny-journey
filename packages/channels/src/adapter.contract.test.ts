import { CONTRACT_DATA, runChannelAdapterContract } from "./testing/adapter-contract";
import { FakeAdapter, FakeOutbox, signFakeWebhook, FAKE_SIGNATURE_HEADER } from "./fake/adapter";
import type { FakeWebhookPayload } from "./fake/adapter";

// Cada adaptador agrega aquí su corrida del contrato (Evolution en T1.3 y T1.4, Meta en la fase 2).

const d = CONTRACT_DATA;

const groupMessage = (over: Record<string, unknown> = {}): FakeWebhookPayload => ({
  kind: "message",
  message: {
    externalId: d.externalId,
    chat: { jid: d.groupJid },
    sender: { jid: `${d.senderPhone}@s.whatsapp.net`, name: d.senderName },
    text: d.text,
    waTimestamp: d.waTimestampSec,
    ...over,
  },
});

runChannelAdapterContract("fake", () => {
  const outbox = new FakeOutbox();
  const adapter = new FakeAdapter({ channelId: "ch-1", tenantId: "t-1", outbox });
  return {
    adapter,
    channelId: "ch-1",
    tenantId: "t-1",
    inbound: {
      groupText: groupMessage(),
      directText: {
        kind: "message",
        message: {
          externalId: "dm-1",
          chat: { jid: `${d.directPhone}@s.whatsapp.net` },
          sender: { jid: `${d.directPhone}@s.whatsapp.net` },
          text: "hola",
          waTimestamp: d.waTimestampSec,
        },
      },
      fromMe: groupMessage({ fromMe: true }),
      lidWithPhone: groupMessage({ sender: { jid: `${d.lid}@lid`, phone: d.lidPhone } }),
      lidWithoutPhone: groupMessage({ sender: { jid: `${d.lid}@lid` } }),
      mediaWithCaption: groupMessage({ type: "media", text: d.caption }),
      connectionOpen: { kind: "connection", status: "open" },
      invalid: { event: "messages.upsert", data: {} },
    },
    outbound: { sent: () => outbox.sent },
    signature: {
      secret: "s3cr3t",
      sign: (raw) => ({ [FAKE_SIGNATURE_HEADER]: signFakeWebhook(raw, "s3cr3t") }),
    },
  };
});
