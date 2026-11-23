import type { ChannelRow, Provider } from "@ravyn/channels";
import { groupJidsFromTriggers, type ModuleRegistry } from "@ravyn/core";
import type { RoutingSnapshot } from "@ravyn/db";
import type { Logger } from "pino";

/**
 * Tabla de ruteo en memoria (plan, 6.1):
 *
 *   routing[channelId] = { tenantId, groupJids: Map<jid, agentConfigId[]> }
 *
 * Se construye con los disparadores (`triggers(config)`) de los agentes `active` u `observe`.
 * Un config inválido o un módulo desconocido no tumba la tabla: ese agente se omite y se
 * registra un aviso (solo ids).
 */

export interface ChannelRoute {
  channelId: string;
  tenantId: string;
  provider: Provider | string;
  /** sha256 (hex) del token de la ruta del webhook. */
  tokenHash: string;
  /** Fila para `ChannelRegistry.get()`. */
  row: ChannelRow;
  groupJids: ReadonlyMap<string, readonly string[]>;
}

export interface RoutingStats {
  channels: number;
  agents: number;
  skippedAgents: number;
  groupJids: number;
}

export function buildRoutes(
  snapshot: RoutingSnapshot,
  modules: ModuleRegistry,
  logger?: Pick<Logger, "warn">,
): { routes: Map<string, ChannelRoute>; stats: RoutingStats } {
  const groups = new Map<string, Map<string, string[]>>();
  let agents = 0;
  let skippedAgents = 0;

  for (const agent of snapshot.agents) {
    let jids: string[];
    try {
      jids = groupJidsFromTriggers(modules.triggers(agent.module_key, agent.config));
    } catch {
      skippedAgents++;
      logger?.warn(
        { agentConfigId: agent.id, moduleKey: agent.module_key },
        "ruteo: agente omitido (módulo desconocido o config inválido)",
      );
      continue;
    }
    agents++;
    const byJid = groups.get(agent.channel_id) ?? new Map<string, string[]>();
    for (const jid of jids) byJid.set(jid, [...(byJid.get(jid) ?? []), agent.id]);
    groups.set(agent.channel_id, byJid);
  }

  const routes = new Map<string, ChannelRoute>();
  let groupJids = 0;
  for (const ch of snapshot.channels) {
    const byJid = groups.get(ch.id) ?? new Map<string, string[]>();
    groupJids += byJid.size;
    routes.set(ch.id, {
      channelId: ch.id,
      tenantId: ch.tenant_id,
      provider: ch.provider,
      tokenHash: ch.webhook_token_hash,
      row: {
        id: ch.id,
        tenant_id: ch.tenant_id,
        provider: ch.provider,
        external_instance: ch.external_instance,
        phone: ch.phone,
        status: ch.status,
        settings: ch.settings,
      },
      groupJids: byJid,
    });
  }
  return { routes, stats: { channels: routes.size, agents, skippedAgents, groupJids } };
}

export interface RoutingTableOptions {
  load: () => Promise<RoutingSnapshot>;
  modules: ModuleRegistry;
  logger: Logger;
}

export class RoutingTable {
  private routes = new Map<string, ChannelRoute>();
  private inflight: Promise<RoutingStats> | null = null;
  private pending = false;
  private loadedAt: Date | null = null;

  constructor(private readonly opts: RoutingTableOptions) {}

  get(channelId: string): ChannelRoute | undefined {
    return this.routes.get(channelId);
  }

  get isLoaded(): boolean {
    return this.loadedAt !== null;
  }

  /**
   * Recarga desde la base. Las llamadas concurrentes se agrupan: si llega otra mientras una
   * está en curso, se hace exactamente una recarga más al terminar. Si la carga falla, se
   * conserva la tabla anterior.
   */
  reload(): Promise<RoutingStats> {
    if (this.inflight) {
      this.pending = true;
      return this.inflight;
    }
    this.inflight = this.doReload().finally(() => {
      this.inflight = null;
      if (this.pending) {
        this.pending = false;
        void this.reload().catch(() => {});
      }
    });
    return this.inflight;
  }

  private async doReload(): Promise<RoutingStats> {
    try {
      const snapshot = await this.opts.load();
      const { routes, stats } = buildRoutes(snapshot, this.opts.modules, this.opts.logger);
      this.routes = routes;
      this.loadedAt = new Date();
      this.opts.logger.info({ routing: stats }, "ruteo: tabla recargada");
      return stats;
    } catch (err) {
      this.opts.logger.error(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        "ruteo: falló la recarga; se conserva la tabla anterior",
      );
      throw err;
    }
  }
}
