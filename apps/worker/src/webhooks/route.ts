import type { ChannelEvent, ChannelRegistry } from "@ravyn/channels";
import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { RoutingTable, ChannelRoute } from "../routing/table";
import { serializeInbound } from "./inbound-job";
import type { InboundSink } from "./inbound-sink";
import { tokenMatches } from "./token";

/**
 * `POST /webhooks/:provider/:channelId/:token` (plan, 6.1 y 2.2).
 *
 * Privacidad: un mensaje de un JID no suscrito (DM, otro grupo, `fromMe`) se descarta aquí,
 * en memoria, sin tocar la base, Redis ni la cola, y sin registrar nada de su contenido; solo
 * sube un contador agregado. Esta ruta nunca registra el cuerpo, los encabezados ni el token.
 */

export type ChannelEventHandler = (
  route: ChannelRoute,
  event: Extract<ChannelEvent, { kind: "connection" | "qr" }>,
) => void | Promise<void>;

/** Contadores agregados en memoria (`inbound_ignored_total{channel}` y afines). */
export class InboundCounters {
  readonly ignoredByChannel = new Map<string, number>();
  readonly ignoredByReason = new Map<string, number>();
  accepted = 0;
  duplicates = 0;

  ignore(channelId: string, reason: string): void {
    this.ignoredByChannel.set(channelId, (this.ignoredByChannel.get(channelId) ?? 0) + 1);
    this.ignoredByReason.set(reason, (this.ignoredByReason.get(reason) ?? 0) + 1);
  }

  snapshot() {
    return {
      accepted: this.accepted,
      duplicates: this.duplicates,
      ignoredByChannel: Object.fromEntries(this.ignoredByChannel),
      ignoredByReason: Object.fromEntries(this.ignoredByReason),
    };
  }
}

export interface WebhookDeps {
  routing: RoutingTable;
  channels: ChannelRegistry;
  sink: InboundSink;
  counters: InboundCounters;
  onChannelEvent?: ChannelEventHandler;
}

interface Params {
  provider: string;
  channelId: string;
  token: string;
}

type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger
>;

export function registerWebhookRoutes(app: App, deps: WebhookDeps): void {
  const { routing, channels, sink, counters } = deps;

  app.post<{ Params: Params }>(
    "/webhooks/:provider/:channelId/:token",
    // Cada mensaje del grupo genera una petición: no se registra salvo error.
    { logLevel: "warn" },
    async (req, reply) => {
      const { provider, channelId, token } = req.params;
      const route = routing.get(channelId);
      // tokenMatches siempre hace la comparación completa (tiempo constante).
      const authorized = tokenMatches(token, route?.tokenHash);
      if (!route || !authorized || route.provider !== provider) {
        // 404 también con token incorrecto: no se revela qué canales existen.
        return reply.code(404).send({ error: "No encontrado" });
      }

      let events: ChannelEvent[];
      try {
        events = channels.get(route.row).parseWebhook(req.body, {});
      } catch (err) {
        req.log.warn(
          { channelId, err: { message: err instanceof Error ? err.message : String(err) } },
          "webhook: no se pudo construir el adaptador",
        );
        return reply.code(200).send({ ok: true });
      }

      for (const event of events) {
        switch (event.kind) {
          case "message": {
            const m = event.message;
            const agentConfigIds = m.fromMe ? undefined : route.groupJids.get(m.chat.jid);
            if (!agentConfigIds || agentConfigIds.length === 0) {
              counters.ignore(channelId, m.fromMe ? "from_me" : "no_suscrito");
              continue;
            }
            if (!(await sink.claim(channelId, m.externalId))) {
              counters.duplicates++;
              continue;
            }
            try {
              await sink.enqueue({
                agentConfigIds: [...agentConfigIds],
                message: serializeInbound(m),
              });
            } catch (err) {
              // Sin la clave de deduplicación, el reintento de Evolution sí se encola.
              await sink.release(channelId, m.externalId).catch(() => {});
              throw err;
            }
            counters.accepted++;
            break;
          }
          case "connection":
          case "qr":
            if (deps.onChannelEvent) {
              await Promise.resolve(deps.onChannelEvent(route, event)).catch((err: unknown) =>
                req.log.warn(
                  {
                    channelId,
                    kind: event.kind,
                    err: { message: err instanceof Error ? err.message : String(err) },
                  },
                  "webhook: falló el manejo de un evento de canal",
                ),
              );
            }
            break;
          case "ignored":
            counters.ignore(channelId, event.reason);
            break;
        }
      }
      return reply.code(200).send({ ok: true });
    },
  );
}

/** Manejador por defecto hasta T1.18: registra el cambio de estado (sin QR ni código). */
export function logChannelEvents(log: {
  info(obj: object, msg: string): void;
}): ChannelEventHandler {
  return (route, event) => {
    if (event.kind === "connection") {
      log.info({ channelId: route.channelId, status: event.status }, "canal: cambio de conexión");
    } else {
      log.info(
        { channelId: route.channelId, hasPairingCode: event.pairingCode !== null },
        "canal: QR actualizado",
      );
    }
  };
}
