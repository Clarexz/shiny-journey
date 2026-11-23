import { CONTRACT_DATA, runChannelAdapterContract } from "./testing/adapter-contract";
import { FakeAdapter, FakeOutbox, signFakeWebhook, FAKE_SIGNATURE_HEADER } from "./fake/adapter";
import type { FakeWebhookPayload } from "./fake/adapter";
import { afterAll, beforeAll } from "vitest";
import { EvolutionAdapter, WEBHOOK_TOKEN_HEADER } from "./evolution/adapter";
import { evolutionFixtures, FIXTURE_INSTANCE } from "./evolution/fixtures";
import { sendTextReply, startMockEvolution, type MockEvolution } from "./evolution/mock-server";

// Cada adaptador agrega aquí su corrida del contrato (Meta Cloud en la fase 2).

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

let evolution: MockEvolution;
beforeAll(async () => {
  evolution = await startMockEvolution();
});
afterAll(() => evolution.close());

runChannelAdapterContract("evolution", () => {
  evolution.reset();
  evolution.on(`POST /message/sendText/${FIXTURE_INSTANCE}`, sendTextReply());
  const adapter = new EvolutionAdapter({
    client: { baseUrl: evolution.url, apiKey: "clave-falsa" },
    channelId: "ch-1",
    tenantId: "t-1",
    instance: FIXTURE_INSTANCE,
  });
  return {
    adapter,
    channelId: "ch-1",
    tenantId: "t-1",
    inbound: evolutionFixtures,
    outbound: {
      sent: () =>
        evolution.requests
          .filter((r) => r.path.startsWith("/message/sendText/"))
          .map((r) => {
            const body = r.body as { number: string; text: string };
            return { to: { phone: body.number }, text: body.text };
          }),
    },
    signature: {
      secret: "s3cr3t",
      sign: () => ({ [WEBHOOK_TOKEN_HEADER]: "s3cr3t" }),
      bindsBody: false,
    },
  };
});
