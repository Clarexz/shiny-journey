import { describe, expect, it, vi } from "vitest";
import { ChannelError } from "../types";
import { FakeAdapter, FakeOutbox } from "./adapter";

const make = (opts: Partial<ConstructorParameters<typeof FakeAdapter>[0]> = {}) =>
  new FakeAdapter({ channelId: "ch-1", tenantId: "t-1", ...opts });

const send = (adapter: FakeAdapter, key = "k1") =>
  adapter.sendText({ to: { phone: "5218991234567" }, text: "hola", idempotencyKey: key });

describe("FakeAdapter: entrada", () => {
  it("acepta varios eventos en un solo payload", () => {
    const events = make().parseWebhook(
      {
        events: [
          { kind: "qr", qr: null, pairingCode: "ABCD-1234" },
          { kind: "connection", status: "closed", detail: { statusCode: 428 } },
        ],
      },
      {},
    );
    expect(events).toEqual([
      { kind: "qr", qr: null, pairingCode: "ABCD-1234" },
      { kind: "connection", status: "closed", detail: { statusCode: 428 } },
    ]);
  });

  it("usa el reloj inyectado para receivedAt y como waTimestamp por defecto", () => {
    const now = new Date("2026-11-09T15:00:01.250Z");
    const [event] = make({ now: () => now }).parseWebhook(
      {
        kind: "message",
        message: {
          externalId: "m1",
          chat: { jid: "120363000000000001@g.us" },
          sender: { jid: "5218991234567@s.whatsapp.net" },
        },
      },
      {},
    );
    expect(event).toMatchObject({
      kind: "message",
      message: { receivedAt: now, waTimestamp: now, type: "other", text: null },
    });
  });

  it("acepta waTimestamp en ISO", () => {
    const [event] = make().parseWebhook(
      {
        kind: "message",
        message: {
          externalId: "m1",
          chat: { jid: "120363000000000001@g.us" },
          sender: { jid: "5218991234567@s.whatsapp.net" },
          text: "x",
          waTimestamp: "2026-11-09T09:00:00-06:00",
        },
      },
      {},
    );
    expect(event?.kind === "message" && event.message.waTimestamp.toISOString()).toBe(
      "2026-11-09T15:00:00.000Z",
    );
  });
});

describe("FakeAdapter: salida", () => {
  it("es idempotente por clave dentro del canal", async () => {
    const outbox = new FakeOutbox();
    const a = make({ outbox });
    const b = new FakeAdapter({ channelId: "ch-2", tenantId: "t-1", outbox });
    const first = await send(a);
    expect(await send(a)).toEqual(first);
    await send(b);
    expect(outbox.sent).toHaveLength(2);
    expect(outbox.forChannel("ch-1")).toHaveLength(1);
  });

  it("aplica la latencia configurada y, si se pide, el typingMs", async () => {
    const sleep = vi.fn(async () => {});
    await make({ sendLatencyMs: 120, sleep }).sendText({
      to: { jid: "5218991234567@s.whatsapp.net" },
      text: "hola",
      typingMs: 900,
      idempotencyKey: "k",
    });
    expect(sleep).toHaveBeenLastCalledWith(120);
    await make({ sendLatencyMs: 120, honorTypingDelay: true, sleep }).sendText({
      to: { jid: "5218991234567@s.whatsapp.net" },
      text: "hola",
      typingMs: 900,
      idempotencyKey: "k",
    });
    expect(sleep).toHaveBeenLastCalledWith(1020);
  });

  it("falla con not_connected si la sesión no está abierta", async () => {
    const a = make({ status: "closed" });
    await expect(send(a)).rejects.toMatchObject({ code: "not_connected", retryable: true });
    expect(a.outbox.sent).toHaveLength(0);
  });

  it("failNextSend hace fallar solo el envío que coincide, una vez", async () => {
    const a = make();
    a.failNextSend(
      new ChannelError("number_not_found", "no existe", { provider: "fake" }),
      (i) => i.to.phone === "5218991234567",
    );
    await expect(
      a.sendText({ to: { phone: "528991234567" }, text: "x", idempotencyKey: "a" }),
    ).resolves.toBeDefined();
    await expect(send(a, "b")).rejects.toMatchObject({ code: "number_not_found" });
    await expect(send(a, "c")).resolves.toBeDefined();
  });
});

describe("FakeAdapter: ciclo de vida y grupos", () => {
  it("simula vinculación, reinicio y cierre de sesión", async () => {
    const a = make({ status: "pending_qr" });
    await a.createSession({ instance: "t-demo-1", webhookUrl: "http://worker:3001/x" });
    expect(a.instance).toBe("t-demo-1");
    expect(await a.connect({})).toEqual({ qr: "fake-qr", pairingCode: null });
    expect(await a.connect({ pairingPhone: "528991234567" })).toEqual({
      qr: null,
      pairingCode: "FAKE-1234",
    });
    await expect(a.connect({ pairingPhone: "abc" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await a.restart();
    expect(await a.getStatus()).toBe("open");
    await a.logout();
    await a.restart();
    expect(await a.getStatus()).toBe("logged_out");
    expect(a.calls.map((c) => c.method)).toEqual([
      "createSession",
      "connect",
      "connect",
      "connect",
      "restart",
      "logout",
      "restart",
    ]);
  });

  it("lista grupos y participantes configurados", async () => {
    const group = { jid: "120363000000000001@g.us", subject: "Coberturas", size: 2 };
    const participants = [
      { jid: "5218991234567@s.whatsapp.net", phone: "5218991234567", lid: null },
      { jid: "123@lid", phone: null, lid: "123" },
    ];
    const a = make({ groups: [group], participants: { [group.jid]: participants } });
    expect(await a.listGroups()).toEqual([group]);
    expect(await a.getGroupParticipants(group.jid)).toEqual(participants);
    await expect(a.getGroupParticipants("120363999@g.us")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(a.getGroupParticipants("5218991234567@s.whatsapp.net")).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
