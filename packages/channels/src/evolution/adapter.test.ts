import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ChannelError } from "../types";
import {
  EVOLUTION_INSTANCE_SETTINGS,
  EVOLUTION_WEBHOOK_EVENTS,
  EvolutionAdapter,
  WEBHOOK_TOKEN_HEADER,
} from "./adapter";
import { EvolutionClient } from "./client";
import {
  numberNotFoundReply,
  sendTextReply,
  startMockEvolution,
  type MockEvolution,
} from "./mock-server";

let mock: MockEvolution;
beforeAll(async () => {
  mock = await startMockEvolution();
});
afterAll(() => mock.close());
beforeEach(() => mock.reset());

const API_KEY = "clave-global-falsa";

function adapter(over: { timeoutMs?: number; webhookSecret?: string } = {}) {
  return new EvolutionAdapter({
    client: { baseUrl: `${mock.url}/`, apiKey: API_KEY, timeoutMs: over.timeoutMs ?? 2000 },
    channelId: "ch-1",
    tenantId: "t-1",
    instance: "t-demo-1",
    webhookSecret: over.webhookSecret,
  });
}

async function codeOf(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ChannelError);
  return (err as ChannelError).code;
}

describe("EvolutionAdapter: sendText", () => {
  it("envía a /message/sendText con apikey, delay y sin vista previa", async () => {
    mock.on("POST /message/sendText/t-demo-1", sendTextReply("MSG-1"));
    const res = await adapter().sendText({
      to: { phone: "528991234567" },
      text: "Buenos días, me interesa la cobertura.",
      typingMs: 850.4,
      idempotencyKey: "k1",
    });
    expect(res).toEqual({ providerMessageId: "MSG-1" });
    expect(mock.requests).toHaveLength(1);
    const [req] = mock.requests;
    expect(req?.headers.apikey).toBe(API_KEY);
    expect(req?.headers["content-type"]).toBe("application/json");
    expect(req?.body).toEqual({
      number: "5218991234567",
      text: "Buenos días, me interesa la cobertura.",
      delay: 850,
      linkPreview: false,
    });
  });

  it("si el número con 1 no existe, prueba sin él", async () => {
    mock.on("POST /message/sendText/t-demo-1", (req) =>
      (req.body as { number: string }).number === "5218991234567"
        ? numberNotFoundReply("5218991234567")
        : sendTextReply("MSG-2", "528991234567"),
    );
    const res = await adapter().sendText({
      to: { jid: "5218991234567@s.whatsapp.net" },
      text: "hola",
      idempotencyKey: "k",
    });
    expect(res.providerMessageId).toBe("MSG-2");
    expect(mock.requests.map((r) => (r.body as { number: string }).number)).toEqual([
      "5218991234567",
      "528991234567",
    ]);
  });

  it("si ninguna variante existe, falla con number_not_found", async () => {
    mock.on("POST /message/sendText/t-demo-1", (req) =>
      numberNotFoundReply((req.body as { number: string }).number),
    );
    const send = adapter().sendText({
      to: { phone: "5218991234567" },
      text: "x",
      idempotencyKey: "k",
    });
    expect(await codeOf(send)).toBe("number_not_found");
    expect(mock.requests).toHaveLength(2);
  });

  it("un número de otro país no tiene variantes", async () => {
    mock.on("POST /message/sendText/t-demo-1", numberNotFoundReply("14155552671"));
    expect(
      await codeOf(
        adapter().sendText({ to: { phone: "+1 415 555 2671" }, text: "x", idempotencyKey: "k" }),
      ),
    ).toBe("number_not_found");
    expect(mock.requests).toHaveLength(1);
  });

  it("envía a un JID @lid tal cual (sin dispositivo) y a grupos", async () => {
    mock.on("POST /message/sendText/t-demo-1", sendTextReply());
    const a = adapter();
    await a.sendText({ to: { jid: "123456789012345:2@lid" }, text: "x", idempotencyKey: "a" });
    await a.sendText({ to: { jid: "120363000000000001@g.us" }, text: "x", idempotencyKey: "b" });
    expect(mock.requests.map((r) => (r.body as { number: string }).number)).toEqual([
      "123456789012345@lid",
      "120363000000000001@g.us",
    ]);
  });

  it("rechaza destinos inválidos sin llamar a Evolution", async () => {
    const a = adapter();
    for (const to of [{ phone: "abc" }, { jid: "status@broadcast" }, { jid: "abc@lid" }]) {
      expect(await codeOf(a.sendText({ to, text: "x", idempotencyKey: "k" }))).toBe(
        "invalid_input",
      );
    }
    expect(mock.requests).toHaveLength(0);
  });

  it("una respuesta sin key.id es provider_error", async () => {
    mock.on("POST /message/sendText/t-demo-1", { status: 201, body: {} });
    expect(
      await codeOf(
        adapter().sendText({ to: { phone: "5218991234567" }, text: "x", idempotencyKey: "k" }),
      ),
    ).toBe("provider_error");
  });

  it("el timeout incluye el delay", async () => {
    mock.on("POST /message/sendText/t-demo-1", { ...sendTextReply(), delayMs: 150 });
    const a = adapter({ timeoutMs: 100 });
    await expect(
      a.sendText({ to: { phone: "5218991234567" }, text: "x", typingMs: 200, idempotencyKey: "k" }),
    ).resolves.toBeDefined();
  });
});

describe("EvolutionClient: errores", () => {
  const client = (timeoutMs = 2000) =>
    new EvolutionClient({ baseUrl: mock.url, apiKey: API_KEY, timeoutMs });

  it.each([
    [401, { status: 401, error: "Unauthorized" }, "unauthorized", false],
    [
      404,
      { status: 404, response: { message: ['The "x" instance does not exist'] } },
      "not_found",
      false,
    ],
    [429, {}, "rate_limited", true],
    [400, { status: 400, response: { message: ["Connection Closed"] } }, "not_connected", true],
    [500, { status: 500, error: "Internal Server Error" }, "provider_error", true],
    [400, { status: 400, response: { message: ["otro"] } }, "provider_error", false],
    [
      403,
      { status: 403, response: { message: ['This name "t-demo-1" is already in use.'] } },
      "invalid_input",
      false,
    ],
  ])("HTTP %i -> %s", async (status, body, code, retryable) => {
    mock.on("GET /x", { status, body });
    const err = await client()
      .request({ method: "GET", path: "/x", op: "prueba" })
      .catch((e: unknown) => e as ChannelError);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ code, retryable, status, provider: "evolution" });
    expect((err as ChannelError).message).toBe(`Evolution prueba: HTTP ${status}`);
  });

  it("timeout", async () => {
    mock.on("GET /lento", { body: {}, delayMs: 300 });
    const err = await client(50)
      .request({ method: "GET", path: "/lento", op: "lento" })
      .catch((e: unknown) => e as ChannelError);
    expect(err).toMatchObject({ code: "timeout", retryable: true });
  });

  it("error de red", async () => {
    const c = new EvolutionClient({ baseUrl: "http://127.0.0.1:1", apiKey: API_KEY });
    const err = await c.request({ method: "GET", path: "/", op: "red" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "network", retryable: true });
  });

  it("el mensaje de error no incluye el cuerpo ni la query", async () => {
    mock.on("GET /instance/connect/t-demo-1", numberNotFoundReply("5218991234567"));
    const err = await adapter()
      .connect({ pairingPhone: "5218991234567" })
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(ChannelError);
    expect((err as Error).message).not.toContain("8991234567");
  });

  it("exige API key", () => {
    expect(() => new EvolutionClient({ baseUrl: mock.url, apiKey: "" })).toThrow(ChannelError);
  });
});

describe("EvolutionAdapter: ciclo de vida", () => {
  const webhookUrl = "http://worker:3001/webhooks/evolution/ch-1/token-falso";

  it("createSession crea la instancia, el webhook y los ajustes de 5.3", async () => {
    mock.on("POST /instance/create", {
      status: 201,
      body: { instance: { instanceName: "t-demo-1" } },
    });
    mock.on("POST /webhook/set/t-demo-1", { status: 201, body: {} });
    mock.on("POST /settings/set/t-demo-1", { status: 201, body: {} });
    await adapter({ webhookSecret: "secreto" }).createSession({ instance: "t-demo-1", webhookUrl });

    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /instance/create",
      "POST /webhook/set/t-demo-1",
      "POST /settings/set/t-demo-1",
    ]);
    expect(mock.requests[0]?.body).toEqual({
      instanceName: "t-demo-1",
      integration: "WHATSAPP-BAILEYS",
      qrcode: false,
    });
    expect(mock.requests[1]?.body).toEqual({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
        headers: { [WEBHOOK_TOKEN_HEADER]: "secreto" },
      },
    });
    expect(mock.requests[2]?.body).toEqual(EVOLUTION_INSTANCE_SETTINGS);
    expect(mock.requests[2]?.body).toMatchObject({
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      syncFullHistory: false,
      rejectCall: false,
    });
  });

  it("createSession es idempotente si la instancia ya existe", async () => {
    mock.on("POST /instance/create", {
      status: 403,
      body: { status: 403, response: { message: ['This name "t-demo-1" is already in use.'] } },
    });
    mock.on("POST /webhook/set/t-demo-1", { status: 201, body: {} });
    mock.on("POST /settings/set/t-demo-1", { status: 201, body: {} });
    await adapter().createSession({ instance: "t-demo-1", webhookUrl });
    expect(mock.requests).toHaveLength(3);
    expect(mock.requests[1]?.body).not.toHaveProperty("webhook.headers");
  });

  it("createSession propaga otros errores y rechaza otra instancia", async () => {
    mock.on("POST /instance/create", { status: 401, body: {} });
    expect(await codeOf(adapter().createSession({ instance: "t-demo-1", webhookUrl }))).toBe(
      "unauthorized",
    );
    expect(await codeOf(adapter().createSession({ instance: "t-otro-1", webhookUrl }))).toBe(
      "invalid_input",
    );
  });

  it("connect con teléfono devuelve el código de vinculación", async () => {
    mock.on("GET /instance/connect/t-demo-1", {
      body: {
        pairingCode: "WZYEH1YY",
        code: "2@abc",
        base64: "data:image/png;base64,AA==",
        count: 1,
      },
    });
    expect(await adapter().connect({ pairingPhone: "899 123 4567" })).toEqual({
      qr: "data:image/png;base64,AA==",
      pairingCode: "WZYEH1YY",
    });
    expect(mock.requests[0]?.query).toEqual({ number: "5218991234567" });
  });

  it("connect sin teléfono solo pide QR", async () => {
    mock.on("GET /instance/connect/t-demo-1", { body: { code: "2@abc", count: 1 } });
    expect(await adapter().connect({})).toEqual({ qr: "2@abc", pairingCode: null });
    expect(mock.requests[0]?.query).toEqual({});
    expect(await codeOf(adapter().connect({ pairingPhone: "123" }))).toBe("invalid_input");
  });

  it("getStatus mapea connectionState", async () => {
    mock.on("GET /instance/connectionState/t-demo-1", {
      body: { instance: { instanceName: "t-demo-1", state: "open" } },
    });
    expect(await adapter().getStatus()).toBe("open");
    mock.on("GET /instance/connectionState/t-demo-1", { body: { instance: { state: "close" } } });
    expect(await adapter().getStatus()).toBe("closed");
    mock.on("GET /instance/connectionState/t-demo-1", { body: { instance: { state: "???" } } });
    expect(await adapter().getStatus()).toBe("error");
  });

  it("restart y logout", async () => {
    mock.on("POST /instance/restart/t-demo-1", { body: { instance: { state: "connecting" } } });
    mock.on("DELETE /instance/logout/t-demo-1", { body: { status: "SUCCESS" } });
    await adapter().restart();
    await adapter().logout();
    expect(mock.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /instance/restart/t-demo-1",
      "DELETE /instance/logout/t-demo-1",
    ]);
    expect(mock.requests.every((r) => r.headers.apikey === API_KEY)).toBe(true);
  });

  it("codifica el nombre de instancia en la ruta", async () => {
    const a = new EvolutionAdapter({
      client: { baseUrl: mock.url, apiKey: API_KEY },
      channelId: "ch-1",
      tenantId: "t-1",
      instance: "t demo/1",
    });
    mock.on("POST /instance/restart/t%20demo%2F1", { body: {} });
    await a.restart();
    expect(mock.requests[0]?.path).toBe("/instance/restart/t%20demo%2F1");
  });
});

describe("EvolutionAdapter: grupos", () => {
  it("listGroups usa fetchAllGroups sin participantes", async () => {
    mock.on("GET /group/fetchAllGroups/t-demo-1", {
      body: [
        { id: "120363000000000001@g.us", subject: "Coberturas Reynosa", size: 180 },
        { id: "120363000000000002@g.us", subject: "Otro", participants: [{}, {}] },
        { id: "5218991234567@s.whatsapp.net", subject: "no es grupo" },
        "basura",
      ],
    });
    expect(await adapter().listGroups()).toEqual([
      { jid: "120363000000000001@g.us", subject: "Coberturas Reynosa", size: 180 },
      { jid: "120363000000000002@g.us", subject: "Otro", size: 2 },
    ]);
    expect(mock.requests[0]?.query).toEqual({ getParticipants: "false" });
  });

  it("getGroupParticipants resuelve teléfono y LID según los campos disponibles", async () => {
    mock.on("GET /group/participants/t-demo-1", {
      body: {
        participants: [
          { id: "528991234567@s.whatsapp.net", admin: null },
          { id: "123456789012345@lid", phoneNumber: "5218990001111@s.whatsapp.net" },
          { id: "999@lid" },
          { admin: "admin" },
        ],
      },
    });
    expect(await adapter().getGroupParticipants("120363000000000001@g.us")).toEqual([
      { jid: "528991234567@s.whatsapp.net", phone: "5218991234567", lid: null },
      { jid: "123456789012345@lid", phone: "5218990001111", lid: "123456789012345" },
      { jid: "999@lid", phone: null, lid: "999" },
    ]);
    expect(mock.requests[0]?.query).toEqual({ groupJid: "120363000000000001@g.us" });
    expect(await codeOf(adapter().getGroupParticipants("5218991234567@s.whatsapp.net"))).toBe(
      "invalid_input",
    );
  });
});

describe("EvolutionAdapter: verifyWebhook", () => {
  it("compara el encabezado con el secreto", () => {
    const a = adapter();
    const raw = Buffer.from("{}");
    expect(a.verifyWebhook(raw, { [WEBHOOK_TOKEN_HEADER]: "s" }, "s")).toBe(true);
    expect(a.verifyWebhook(raw, { [WEBHOOK_TOKEN_HEADER]: "s2" }, "s")).toBe(false);
    expect(a.verifyWebhook(raw, {}, "s")).toBe(false);
    expect(a.verifyWebhook(raw, { [WEBHOOK_TOKEN_HEADER]: "" }, "")).toBe(false);
  });
});
