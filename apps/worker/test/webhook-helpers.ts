/**
 * Utilidades compartidas de las pruebas de webhooks: canal de prueba, fixtures reales de
 * Evolution (T1.6), captura de logs y un sink en memoria.
 */
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createChannelRegistry } from "@ravyn/channels";
import { ModuleRegistry } from "@ravyn/core";
import { echoModule } from "@ravyn/core/testing";
import type { RoutingSnapshot } from "@ravyn/db";
import { createLogger } from "../src/logger";
import { RoutingTable } from "../src/routing/table";
import { buildServer } from "../src/server";
import type { InboundJobData } from "../src/webhooks/inbound-job";
import type { InboundSink } from "../src/webhooks/inbound-sink";
import { InboundCounters, type ChannelEventHandler } from "../src/webhooks/route";
import { hashToken } from "../src/webhooks/token";

export const CHANNEL_ID = "00000000-0000-4000-c000-000000000001";
export const TENANT_ID = "00000000-0000-4000-a000-000000000001";
export const AGENT_ID = "00000000-0000-4000-d000-000000000001";
export const TOKEN = "token-de-prueba-del-webhook";
export const TARGET_GROUP = "120363000000000001@g.us";
export const OTHER_GROUP = "120363999999999999@g.us";
export const WEBHOOK_URL = `/webhooks/evolution/${CHANNEL_ID}/${TOKEN}`;

const FIXTURES = fileURLToPath(
  new URL("../../../modules/apartador-turnos/fixtures/evolution/", import.meta.url),
);

export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURES + name, "utf8"));
}

/** Mensaje real del grupo objetivo, con texto e id propios. */
export function groupMessage(text: string, id: string, groupJid = TARGET_GROUP) {
  const raw = fixture("group-text-quoted-lid-alt.json") as {
    data: { key: Record<string, unknown>; message: Record<string, unknown> };
  };
  raw.data.key.id = id;
  raw.data.key.remoteJid = groupJid;
  raw.data.message = { conversation: text };
  return raw;
}

export function directMessage(text: string, id: string) {
  const raw = fixture("dm-text-inbound.json") as {
    data: { key: Record<string, unknown>; message: Record<string, unknown> };
  };
  raw.data.key.id = id;
  raw.data.message = { conversation: text };
  return raw;
}

export function snapshot(groupJids: string[] = [TARGET_GROUP]): RoutingSnapshot {
  return {
    channels: [
      {
        id: CHANNEL_ID,
        tenant_id: TENANT_ID,
        provider: "evolution",
        external_instance: "ravyn-test",
        phone: "5218990000001",
        status: "open",
        settings: {},
        webhook_token_hash: hashToken(TOKEN),
      },
    ],
    agents: [
      {
        id: AGENT_ID,
        tenant_id: TENANT_ID,
        module_key: "echo",
        channel_id: CHANNEL_ID,
        status: "active",
        config: { groupJids },
        config_version: 1,
      },
    ],
  };
}

export function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _e, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, stream, all: () => lines.join("") };
}

export class MemorySink implements InboundSink {
  readonly seen = new Set<string>();
  readonly jobs: InboundJobData[] = [];
  failEnqueue = false;
  async claim(channelId: string, externalId: string) {
    const k = `${channelId}:${externalId}`;
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    return true;
  }
  async enqueue(data: InboundJobData) {
    if (this.failEnqueue) throw new Error("redis caído");
    this.jobs.push(data);
  }
  async release(channelId: string, externalId: string) {
    this.seen.delete(`${channelId}:${externalId}`);
  }
}

export async function buildTestApp(opts: {
  sink: InboundSink;
  load?: () => Promise<RoutingSnapshot>;
  logLevel?: string;
  onChannelEvent?: ChannelEventHandler;
}) {
  const logs = captureLogs();
  // Nivel trace: la prueba de privacidad verifica que ni siquiera en el nivel más detallado
  // se registre contenido.
  const logger = createLogger({ level: opts.logLevel ?? "trace", destination: logs.stream });
  const load = opts.load ?? (async () => snapshot());
  const routing = new RoutingTable({ load, modules: new ModuleRegistry([echoModule]), logger });
  await routing.reload();
  const counters = new InboundCounters();
  const { registry } = createChannelRegistry({
    dryRun: true,
    evolution: { baseUrl: "http://evolution.invalid", apiKey: "k" },
  });
  const app = buildServer({
    logger,
    health: async () => ({ ok: true, redis: true, db: true }),
    webhooks: {
      routing,
      channels: registry,
      sink: opts.sink,
      counters,
      onChannelEvent: opts.onChannelEvent,
    },
  });
  await app.ready();
  return { app, routing, counters, logs };
}
