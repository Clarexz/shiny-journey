import { FakeAdapter, type InboundMessage } from "@ravyn/channels";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTiming } from "../agents/timing";
import { fixedClock, silentLogger, type AgentRuntime, type Notifier } from "../agents/types";
import { echoModule, type EchoConfig } from "./echo";
import { ModuleRegistry, ModuleRegistryError, groupJidsFromTriggers } from "./registry";
import { defineModule } from "./types";

const GROUP = "120363000000000001@g.us";

describe("ModuleRegistry", () => {
  it("registra echo, valida su config y obtiene sus disparadores", () => {
    const registry = new ModuleRegistry([echoModule]);
    expect(registry.has("echo")).toBe(true);
    expect(registry.agents().map((m) => m.key)).toEqual(["echo"]);

    const def = registry.defaultConfig("echo", { tenantTimezone: "America/Matamoros" });
    expect(def).toEqual({ groupJids: [], trigger: "!eco", replyPrefix: "eco: " });
    expect(registry.triggers("echo", def)).toEqual([]);

    const v = registry.validateConfig("echo", { groupJids: [GROUP] });
    expect(v).toEqual({
      ok: true,
      config: { groupJids: [GROUP], trigger: "!eco", replyPrefix: "eco: " },
    });
    const triggers = registry.triggers("echo", { groupJids: [GROUP] });
    expect(triggers).toEqual([{ type: "message.group", chatJids: [GROUP] }]);
    expect(groupJidsFromTriggers(triggers)).toEqual([GROUP]);
  });

  it("devuelve los errores de config por campo", () => {
    const registry = new ModuleRegistry([echoModule]);
    const v = registry.validateConfig("echo", {
      groupJids: ["5218991234567@s.whatsapp.net"],
      trigger: "",
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.map((e) => e.path).sort()).toEqual(["groupJids.0", "trigger"]);
    expect(v.errors.find((e) => e.path === "groupJids.0")?.message).toBe(
      "debe ser un JID de grupo",
    );
    expect(() => registry.triggers("echo", { trigger: "" })).toThrow(ModuleRegistryError);
  });

  it("verifica las capacidades del canal", () => {
    const registry = new ModuleRegistry([echoModule]);
    const meta = new FakeAdapter({ channelId: "c", tenantId: "t", capabilities: ["send_direct"] });
    expect(registry.missingCapabilities("echo", meta)).toEqual(["read_groups"]);
    expect(
      registry.missingCapabilities("echo", new FakeAdapter({ channelId: "c", tenantId: "t" })),
    ).toEqual([]);
  });

  it("rechaza definiciones inválidas", () => {
    const base = {
      version: "1.0.0",
      kind: "feature" as const,
      displayName: "x",
      description: "x",
      configSchema: z.object({ n: z.number() }),
      defaultConfig: () => ({ n: 1 }),
      requiredCapabilities: [],
      triggers: () => [],
    };
    expect(() => new ModuleRegistry([defineModule({ ...base, key: "Mal-Clave" })])).toThrow(
      /Clave/,
    );
    expect(() => new ModuleRegistry([defineModule({ ...base, key: "ok", version: "1" })])).toThrow(
      /semver/,
    );
    expect(() => new ModuleRegistry([defineModule({ ...base, key: "ok", kind: "agent" })])).toThrow(
      /server/,
    );
    expect(
      () =>
        new ModuleRegistry([
          defineModule({
            ...base,
            key: "ok",
            defaultConfig: () => ({ n: "uno" as unknown as number }),
          }),
        ]),
    ).toThrow(/defaultConfig/);
    expect(() => new ModuleRegistry([echoModule, echoModule])).toThrow(/ya registrado/);
    expect(() => new ModuleRegistry().require("nada")).toThrow(/desconocido/);
  });

  it("carga el pipeline una sola vez", async () => {
    const server = vi.fn(echoModule.server!);
    const registry = new ModuleRegistry([{ ...echoModule, server }]);
    const [a, b] = await Promise.all([
      registry.loadPipeline("echo"),
      registry.loadPipeline("echo"),
    ]);
    expect(a).toBe(b);
    expect(server).toHaveBeenCalledTimes(1);
  });
});

describe("pipeline de echo con AgentRuntime", () => {
  const message = (text: string, over: Partial<InboundMessage> = {}): InboundMessage => ({
    provider: "fake",
    channelId: "ch-1",
    tenantId: "t-1",
    externalId: `m-${text}`,
    chat: { jid: GROUP, kind: "group" },
    sender: { jid: "5218991234567@s.whatsapp.net", phone: "5218991234567", lid: null, name: "B" },
    fromMe: false,
    type: "text",
    text,
    waTimestamp: new Date("2026-11-09T15:00:00Z"),
    receivedAt: new Date("2026-11-09T15:00:01Z"),
    ...over,
  });

  function runtime(status: "active" | "observe" = "active") {
    const channel = new FakeAdapter({ channelId: "ch-1", tenantId: "t-1" });
    const notify = { enqueue: vi.fn<Notifier["enqueue"]>(async () => {}) };
    const rt: AgentRuntime<EchoConfig> = {
      tenantId: "t-1",
      tenantTimezone: "America/Matamoros",
      agentConfig: {
        id: "ac-1",
        moduleKey: "echo",
        channelId: "ch-1",
        status,
        config: echoModule.configSchema.parse({ groupJids: [GROUP] }),
        configVersion: 1,
      },
      clock: fixedClock("2026-11-09T15:00:01Z"),
      db: null,
      channel,
      llm: null,
      notify,
      rateLimiter: { tryConsume: async () => ({ ok: true }) },
      logger: silentLogger,
      timing: createTiming(),
    };
    return { rt, channel, notify };
  }

  async function run(msg: InboundMessage, rt: AgentRuntime<EchoConfig>) {
    const p = await new ModuleRegistry([echoModule]).loadPipeline<EchoConfig>("echo");
    if (!p.prefilter(msg, rt.agentConfig.config)) return null;
    const ex = await p.extract(msg, rt);
    const decision = await p.decide(ex, msg, rt);
    return p.act(decision, msg, rt);
  }

  it("activo: responde por DM al autor", async () => {
    const { rt, channel } = runtime();
    const result = await run(message("!eco hola"), rt);
    expect(result).toMatchObject({ ok: true, decision: "APARTAR", reasons: ["cumple"] });
    expect(channel.outbox.sent).toMatchObject([
      { to: { phone: "5218991234567" }, text: "eco: hola" },
    ]);
    expect(rt.timing.snapshot()).toHaveProperty("send");
  });

  it("observación: no envía y avisa", async () => {
    const { rt, channel, notify } = runtime("observe");
    expect(await run(message("!eco hola"), rt)).toMatchObject({
      decision: "OBSERVAR",
      notified: true,
    });
    expect(channel.outbox.sent).toHaveLength(0);
    expect(notify.enqueue).toHaveBeenCalledOnce();
  });

  it("el prefiltro descarta lo que no empieza con el disparador y los mensajes propios", async () => {
    const { rt, channel } = runtime();
    expect(await run(message("hola"), rt)).toBeNull();
    expect(await run(message("!eco x", { fromMe: true }), rt)).toBeNull();
    expect(channel.outbox.sent).toHaveLength(0);
  });

  it("sin cupo de envíos pasa a NOTIFICAR", async () => {
    const { rt, channel } = runtime();
    rt.rateLimiter = { tryConsume: async () => ({ ok: false, reason: "por_hora" }) };
    expect(await run(message("!eco hola"), rt)).toMatchObject({
      decision: "NOTIFICAR",
      reasons: ["limite_envios"],
    });
    expect(channel.outbox.sent).toHaveLength(0);
  });
});
