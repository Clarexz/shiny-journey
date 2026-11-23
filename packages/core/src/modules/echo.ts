/**
 * Módulo `echo`: solo para pruebas del motor y del harness (T1.7). Responde por DM al autor
 * de los mensajes de texto de los grupos configurados que empiezan con `trigger`.
 * No se registra en producción.
 */
import { z } from "zod";
import type { AgentPipeline, Decision } from "../agents/types";
import { defineModule } from "./types";

export const echoConfigSchema = z.object({
  groupJids: z.array(z.string().regex(/@g\.us$/, "debe ser un JID de grupo")).default([]),
  trigger: z.string().min(1).default("!eco"),
  replyPrefix: z.string().default("eco: "),
});

export type EchoConfig = z.infer<typeof echoConfigSchema>;

const pipeline: AgentPipeline<EchoConfig> = {
  prefilter(msg, config) {
    return !msg.fromMe && msg.type === "text" && !!msg.text?.startsWith(config.trigger);
  },

  async extract(msg, rt) {
    const body = (msg.text ?? "").slice(rt.agentConfig.config.trigger.length).trim();
    return { source: "regex", confidence: 1, data: { body } };
  },

  async decide(ex, _msg, rt) {
    const { body } = ex.data as { body: string };
    if (body === "") return { kind: "NOTIFICAR", reasons: ["sin_texto"], notify: "normal" };
    if (rt.agentConfig.status === "observe") {
      return { kind: "OBSERVAR", reasons: ["modo_observacion"], notify: "normal", data: { body } };
    }
    return { kind: "APARTAR", reasons: ["cumple"], notify: "high", data: { body } };
  },

  async act(decision: Decision, msg, rt) {
    if (decision.kind !== "APARTAR") {
      if (decision.notify) {
        await rt.notify.enqueue(rt.tenantId, {
          kind: "sistema",
          priority: decision.notify,
          title: "echo",
          body: decision.reasons.join(", "),
          payload: { externalId: msg.externalId },
        });
      }
      return {
        ok: true,
        decision: decision.kind,
        reasons: decision.reasons,
        notified: !!decision.notify,
      };
    }

    const to = msg.sender.phone ?? msg.sender.jid;
    const limit = await rt.rateLimiter.tryConsume({ channelId: msg.channelId, contact: to });
    if (!limit.ok) {
      return { ok: true, decision: "NOTIFICAR", reasons: ["limite_envios"], notified: false };
    }
    const { body } = decision.data as { body: string };
    const res = await rt.timing.measure("send", () =>
      rt.channel.sendText({
        to: msg.sender.phone ? { phone: msg.sender.phone } : { jid: msg.sender.jid },
        text: `${rt.agentConfig.config.replyPrefix}${body}`,
        idempotencyKey: `${msg.channelId}:${msg.externalId}`,
      }),
    );
    return {
      ok: true,
      decision: "APARTAR",
      reasons: decision.reasons,
      sent: { providerMessageId: res.providerMessageId, to },
    };
  },
};

export const echoModule = defineModule<EchoConfig>({
  key: "echo",
  version: "1.0.0",
  kind: "agent",
  displayName: "Eco (pruebas)",
  description: "Responde por DM los mensajes de un grupo que empiezan con el disparador.",
  configSchema: echoConfigSchema,
  defaultConfig: () => echoConfigSchema.parse({}),
  requiredCapabilities: ["read_groups", "send_direct"],
  triggers: (config) =>
    config.groupJids.length > 0 ? [{ type: "message.group", chatJids: config.groupJids }] : [],
  server: async () => pipeline,
  actions: {
    repetir: {
      description: "Repite el último eco",
      inputSchema: z.object({ externalId: z.string() }),
    },
  },
});
