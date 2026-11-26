import { createChannelRegistry, type FakeOutbox } from "@ravyn/channels";
import type { ModuleRegistry } from "@ravyn/core";
import type { RoutingSnapshot } from "@ravyn/db";
import type { Logger } from "pino";
import type { HealthCheck } from "./health";
import type { Queues } from "./queues";
import type { Redis } from "ioredis";
import { RoutingTable } from "./routing/table";
import { buildServer } from "./server";
import { createRedisInboundSink } from "./webhooks/inbound-sink";
import { InboundCounters, logChannelEvents, type ChannelEventHandler } from "./webhooks/route";

/**
 * Cableado del worker, compartido por `main.ts` y el harness de webhooks (T1.16): canales,
 * módulos, tabla de ruteo, sink de entrada y servidor HTTP. No abre puertos ni suscripciones:
 * eso lo decide quien llama.
 */
export interface ComposeOptions {
  logger: Logger;
  redis: Redis;
  queues: Queues;
  loadRouting: () => Promise<RoutingSnapshot>;
  modules: ModuleRegistry;
  dryRun: boolean;
  evolution?: { baseUrl: string; apiKey: string };
  /** Registro de envíos del modo dry-run (el harness lo inspecciona). */
  outbox?: FakeOutbox;
  health: HealthCheck;
  onChannelEvent?: ChannelEventHandler;
}

export async function composeWorker(o: ComposeOptions) {
  const { registry: channels, outbox } = createChannelRegistry({
    dryRun: o.dryRun,
    outbox: o.outbox,
    evolution: o.evolution,
  });
  const routing = new RoutingTable({ load: o.loadRouting, modules: o.modules, logger: o.logger });
  await routing.reload().catch(() => {
    // Se reintenta con la recarga periódica; mientras tanto los webhooks responden 404.
  });
  const counters = new InboundCounters();
  const app = buildServer({
    logger: o.logger,
    health: o.health,
    webhooks: {
      routing,
      channels,
      sink: createRedisInboundSink(o.redis, o.queues.inbound),
      counters,
      onChannelEvent: o.onChannelEvent ?? logChannelEvents(o.logger),
    },
  });
  return { app, routing, counters, channels, outbox };
}
