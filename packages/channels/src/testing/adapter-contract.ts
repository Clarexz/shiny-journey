/**
 * Prueba de contrato reutilizable de `ChannelAdapter` (plan, 5.6 y 13.1).
 *
 * Cada adaptador la corre con sus propios fixtures (crudos, en el formato de su proveedor)
 * que describen los mismos escenarios con los mismos datos (`CONTRACT_DATA`). Así, Fake,
 * Evolution y Meta tienen que producir exactamente los mismos `InboundMessage`.
 *
 * Este archivo importa Vitest: solo se usa desde pruebas (`@ravyn/channels/testing`).
 */
import { describe, expect, it } from "vitest";
import type { ChannelAdapter, ChannelEvent, InboundMessage, SendTextInput } from "../types";
import { ChannelError, CHANNEL_CAPABILITIES } from "../types";

/** Datos comunes de los escenarios. Los fixtures de cada proveedor los codifican a su formato. */
export const CONTRACT_DATA = {
  groupJid: "120363000000000001@g.us",
  externalId: "CONTRACT-MSG-1",
  /** Segundos desde epoch: 2026-11-09T15:00:00Z. */
  waTimestampSec: 1_762_700_400,
  text: "Buenos días busco cobertura para hoy matutino en cumbres Reynosa 3",
  senderPhone: "5218991234567",
  senderName: "Publicador de prueba",
  directPhone: "5218997654321",
  lid: "123456789012345",
  lidPhone: "5218990001111",
  caption: "foto del turno",
} as const;

export interface ContractInboundFixtures {
  /** Texto en `CONTRACT_DATA.groupJid` de `senderPhone` con `pushName = senderName`. */
  groupText: unknown;
  /** Texto en DM de `directPhone`. */
  directText: unknown;
  /** Texto en el grupo enviado por el propio número. */
  fromMe: unknown;
  /** Texto en el grupo de un remitente `@lid` (`lid`) con el teléfono en un campo alterno (`lidPhone`). */
  lidWithPhone?: unknown;
  /** Texto en el grupo de un remitente `@lid` sin teléfono. */
  lidWithoutPhone?: unknown;
  /** Imagen en el grupo con `caption`. */
  mediaWithCaption?: unknown;
  /** El canal pasa a `open`. */
  connectionOpen?: unknown;
  /** Algo que no es un payload del proveedor. */
  invalid: unknown;
}

export interface ContractOutbound {
  /** Envíos registrados (Fake) o capturados por el servidor simulado (Evolution). */
  sent(): Array<{ to: SendTextInput["to"]; text: string }>;
}

export interface ContractSubject {
  adapter: ChannelAdapter;
  channelId: string;
  tenantId: string;
  inbound?: ContractInboundFixtures;
  outbound?: ContractOutbound;
  /** Para probar `verifyWebhook`: secreto y encabezados firmados para un cuerpo. */
  signature?: {
    secret: string;
    sign(raw: Buffer): Record<string, string>;
    /**
     * `false` si la verificación no depende del cuerpo (Evolution: token en un encabezado,
     * no una firma HMAC). Por defecto `true`.
     */
    bindsBody?: boolean;
  };
}

export function runChannelAdapterContract(
  name: string,
  setup: () => ContractSubject | Promise<ContractSubject>,
): void {
  describe(`ChannelAdapter (contrato): ${name}`, () => {
    it("declara un proveedor y capacidades conocidas", async () => {
      const { adapter } = await setup();
      expect(["evolution", "meta_cloud", "fake"]).toContain(adapter.provider);
      for (const c of adapter.capabilities) {
        expect(CHANNEL_CAPABILITIES).toContain(c);
      }
    });

    describe("entrada", () => {
      const onlyMessage = (events: ChannelEvent[]): InboundMessage => {
        expect(events).toHaveLength(1);
        const [event] = events;
        if (event?.kind !== "message") throw new Error(`se esperaba message, llegó ${event?.kind}`);
        return event.message;
      };

      it("texto en grupo", async () => {
        const s = await setup();
        if (!s.inbound) return;
        const m = onlyMessage(s.adapter.parseWebhook(s.inbound.groupText, {}));
        expect(m).toMatchObject({
          provider: s.adapter.provider,
          channelId: s.channelId,
          tenantId: s.tenantId,
          externalId: CONTRACT_DATA.externalId,
          chat: { jid: CONTRACT_DATA.groupJid, kind: "group" },
          sender: {
            phone: CONTRACT_DATA.senderPhone,
            lid: null,
            name: CONTRACT_DATA.senderName,
          },
          fromMe: false,
          type: "text",
          text: CONTRACT_DATA.text,
        });
        expect(m.sender.jid).toContain("@");
        expect(m.waTimestamp.getTime()).toBe(CONTRACT_DATA.waTimestampSec * 1000);
        expect(m.receivedAt).toBeInstanceOf(Date);
        expect(Number.isNaN(m.receivedAt.getTime())).toBe(false);
      });

      it("texto en DM", async () => {
        const s = await setup();
        if (!s.inbound) return;
        const m = onlyMessage(s.adapter.parseWebhook(s.inbound.directText, {}));
        expect(m.chat.kind).toBe("direct");
        expect(m.sender.phone).toBe(CONTRACT_DATA.directPhone);
        expect(m.fromMe).toBe(false);
      });

      it("mensaje propio (fromMe)", async () => {
        const s = await setup();
        if (!s.inbound) return;
        const m = onlyMessage(s.adapter.parseWebhook(s.inbound.fromMe, {}));
        expect(m.fromMe).toBe(true);
        expect(m.chat.kind).toBe("group");
      });

      it("remitente @lid con teléfono en un campo alterno", async () => {
        const s = await setup();
        if (!s.inbound?.lidWithPhone) return;
        const m = onlyMessage(s.adapter.parseWebhook(s.inbound.lidWithPhone, {}));
        expect(m.sender.jid).toBe(`${CONTRACT_DATA.lid}@lid`);
        expect(m.sender.lid).toBe(CONTRACT_DATA.lid);
        expect(m.sender.phone).toBe(CONTRACT_DATA.lidPhone);
      });

      it("remitente @lid sin teléfono", async () => {
        const s = await setup();
        if (!s.inbound?.lidWithoutPhone) return;
        const m = onlyMessage(s.adapter.parseWebhook(s.inbound.lidWithoutPhone, {}));
        expect(m.sender.lid).toBe(CONTRACT_DATA.lid);
        expect(m.sender.phone).toBeNull();
      });

      it("media con caption", async () => {
        const s = await setup();
        if (!s.inbound?.mediaWithCaption) return;
        const m = onlyMessage(s.adapter.parseWebhook(s.inbound.mediaWithCaption, {}));
        expect(m.type).toBe("media");
        expect(m.text).toBe(CONTRACT_DATA.caption);
      });

      it("cambio de conexión", async () => {
        const s = await setup();
        if (!s.inbound?.connectionOpen) return;
        const events = s.adapter.parseWebhook(s.inbound.connectionOpen, {});
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: "connection", status: "open" });
      });

      it("un payload inválido se ignora sin lanzar", async () => {
        const s = await setup();
        if (!s.inbound) return;
        for (const raw of [s.inbound.invalid, null, undefined, 42, "texto", []]) {
          const events = s.adapter.parseWebhook(raw, {});
          expect(events.every((e) => e.kind === "ignored")).toBe(true);
        }
      });

      it("parseWebhook no tiene efectos: dos llamadas dan lo mismo", async () => {
        const s = await setup();
        if (!s.inbound) return;
        const strip = (events: ChannelEvent[]) =>
          events.map((e) =>
            e.kind === "message" ? { ...e, message: { ...e.message, receivedAt: null } } : e,
          );
        const a = strip(s.adapter.parseWebhook(s.inbound.groupText, {}));
        const b = strip(s.adapter.parseWebhook(s.inbound.groupText, {}));
        expect(a).toEqual(b);
      });
    });

    describe("firma del webhook", () => {
      it("acepta la firma correcta y rechaza las demás", async () => {
        const s = await setup();
        if (!s.signature) return;
        const raw = Buffer.from(JSON.stringify({ ping: true }));
        const headers = s.signature.sign(raw);
        expect(s.adapter.verifyWebhook(raw, headers, s.signature.secret)).toBe(true);
        expect(s.adapter.verifyWebhook(raw, headers, `${s.signature.secret}x`)).toBe(false);
        if (s.signature.bindsBody !== false) {
          expect(s.adapter.verifyWebhook(Buffer.from("otro"), headers, s.signature.secret)).toBe(
            false,
          );
        }
        expect(s.adapter.verifyWebhook(raw, {}, s.signature.secret)).toBe(false);
      });
    });

    describe("salida", () => {
      const input = (over: Partial<SendTextInput> = {}): SendTextInput => ({
        to: { phone: CONTRACT_DATA.senderPhone },
        text: "Buenos días, me interesa la cobertura.",
        typingMs: 800,
        idempotencyKey: "contract-send-1",
        ...over,
      });

      it("sendText devuelve un id del proveedor y entrega el texto", async () => {
        const s = await setup();
        if (!s.outbound) return;
        const { providerMessageId } = await s.adapter.sendText(input());
        expect(providerMessageId).toEqual(expect.any(String));
        expect(providerMessageId.length).toBeGreaterThan(0);
        expect(s.outbound.sent()).toHaveLength(1);
        expect(s.outbound.sent()[0]?.text).toBe("Buenos días, me interesa la cobertura.");
      });

      it("sendText rechaza entradas inválidas con ChannelError invalid_input", async () => {
        const s = await setup();
        if (!s.outbound) return;
        const bad: SendTextInput[] = [
          input({ to: {} }),
          input({ to: { phone: CONTRACT_DATA.senderPhone, jid: "x@s.whatsapp.net" } }),
          input({ text: "   " }),
          input({ idempotencyKey: "" }),
          input({ typingMs: -1 }),
        ];
        for (const b of bad) {
          const err = await s.adapter.sendText(b).catch((e: unknown) => e);
          expect(err).toBeInstanceOf(ChannelError);
          expect((err as ChannelError).code).toBe("invalid_input");
        }
        expect(s.outbound.sent()).toHaveLength(0);
      });
    });
  });
}
