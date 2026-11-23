import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_ID,
  CHANNEL_ID,
  OTHER_GROUP,
  TOKEN,
  WEBHOOK_URL,
  MemorySink,
  buildTestApp,
  directMessage,
  fixture,
  groupMessage,
} from "./webhook-helpers";

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function setup(opts: Parameters<typeof buildTestApp>[0] = { sink: new MemorySink() }) {
  const t = await buildTestApp(opts);
  apps.push(t.app);
  return t;
}

const post = (app: Awaited<ReturnType<typeof setup>>["app"], payload: unknown, url = WEBHOOK_URL) =>
  app.inject({ method: "POST", url, payload: payload as object });

describe("POST /webhooks/:provider/:channelId/:token", () => {
  it("canal desconocido, token incorrecto o proveedor distinto: 404 sin detalle", async () => {
    const sink = new MemorySink();
    const { app } = await setup({ sink });
    const msg = groupMessage("busco cobertura reynosa 3", "A1");
    for (const url of [
      `/webhooks/evolution/00000000-0000-4000-c000-00000000dead/${TOKEN}`,
      `/webhooks/evolution/${CHANNEL_ID}/otro-token`,
      `/webhooks/fake/${CHANNEL_ID}/${TOKEN}`,
    ]) {
      const res = await post(app, msg, url);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "No encontrado" });
    }
    expect(sink.jobs).toHaveLength(0);
  });

  it("un mensaje del grupo objetivo se encola una vez; el duplicado no", async () => {
    const sink = new MemorySink();
    const { app, counters } = await setup({ sink });
    const msg = groupMessage("Busco cobertura hoy matutino Reynosa 3 cumbres", "A2");
    expect((await post(app, msg)).statusCode).toBe(200);
    expect((await post(app, msg)).statusCode).toBe(200);

    expect(sink.jobs).toHaveLength(1);
    expect(sink.jobs[0]).toMatchObject({
      agentConfigIds: [AGENT_ID],
      message: {
        provider: "evolution",
        channelId: CHANNEL_ID,
        externalId: "A2",
        chat: { kind: "group" },
        sender: { phone: "5218990000002", lid: "100000000000003" },
        text: "Busco cobertura hoy matutino Reynosa 3 cumbres",
      },
    });
    expect(typeof sink.jobs[0]?.message.receivedAt).toBe("string");
    expect(counters.snapshot()).toMatchObject({ accepted: 1, duplicates: 1 });
  });

  it("DM, otro grupo y mensajes propios se descartan sin tocar el sink", async () => {
    const sink = new MemorySink();
    const claim = vi.spyOn(sink, "claim");
    const { app, counters } = await setup({ sink });
    await post(app, directMessage("hola doctor", "D1"));
    await post(app, groupMessage("otro grupo", "G1", OTHER_GROUP));
    await post(app, fixture("group-text-fromme-lid-sin-alt.json"));
    expect(claim).not.toHaveBeenCalled();
    expect(sink.jobs).toHaveLength(0);
    expect(counters.snapshot()).toMatchObject({
      accepted: 0,
      ignoredByChannel: { [CHANNEL_ID]: 3 },
      ignoredByReason: { no_suscrito: 2, from_me: 1 },
    });
  });

  it("los eventos de conexión y QR van al manejador; los no soportados se cuentan", async () => {
    const onChannelEvent = vi.fn();
    const { app, counters } = await setup({ sink: new MemorySink(), onChannelEvent });
    await post(app, fixture("connection-update-open.json"));
    await post(app, fixture("qrcode-updated.json"));
    await post(app, { event: "contacts.update", instance: "ravyn-test", data: {} });
    expect(onChannelEvent.mock.calls.map((c) => c[1].kind)).toEqual(["connection", "qr"]);
    expect(onChannelEvent.mock.calls[0]?.[1]).toMatchObject({ status: "open" });
    expect(counters.snapshot().ignoredByReason).toEqual({ evento_no_soportado: 1 });
  });

  it("un payload inválido responde 200 y no encola", async () => {
    const sink = new MemorySink();
    const { app } = await setup({ sink });
    expect((await post(app, { cualquier: "cosa" })).statusCode).toBe(200);
    expect(sink.jobs).toHaveLength(0);
  });

  it("si falla el encolado responde 500 y libera la deduplicación para el reintento", async () => {
    const sink = new MemorySink();
    const { app } = await setup({ sink });
    const msg = groupMessage("busco cobertura reynosa 3", "F1");
    sink.failEnqueue = true;
    expect((await post(app, msg)).statusCode).toBe(500);
    sink.failEnqueue = false;
    expect((await post(app, msg)).statusCode).toBe(200);
    expect(sink.jobs).toHaveLength(1);
  });
});

describe("privacidad del webhook (T1.8)", () => {
  it("no registra contenido ni el token, ni siquiera en nivel trace", async () => {
    const sink = new MemorySink();
    // La única dependencia de la base es la carga del ruteo (lectura); el webhook no escribe.
    const load = vi.fn(async () => (await import("./webhook-helpers")).snapshot());
    const { app, logs } = await setup({ sink, load });
    const secrets = {
      dm: "Doctor, mi hijo tiene fiebre desde ayer",
      other: "Chisme del otro grupo con nombre de paciente",
      target: "Busco cobertura Reynosa 3 cumbres matutino",
      falla: "Mensaje que hace fallar el encolado",
    };
    await post(app, directMessage(secrets.dm, "P1"));
    await post(app, groupMessage(secrets.other, "P2", OTHER_GROUP));
    await post(app, groupMessage(secrets.target, "P3"));
    sink.failEnqueue = true;
    await post(app, groupMessage(secrets.falla, "P4"));

    const out = logs.all();
    expect(out.length).toBeGreaterThan(0); // hay logs (p. ej. el error de encolado)...
    for (const s of [
      ...Object.values(secrets),
      TOKEN,
      "5218990000002",
      "Persona B",
      "100000000000003",
    ]) {
      expect(out).not.toContain(s); // ...pero ninguno con contenido
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(sink.jobs.map((j) => j.message.externalId)).toEqual(["P3"]);
  });
});
