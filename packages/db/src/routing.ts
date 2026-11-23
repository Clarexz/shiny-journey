import type { AdminClient } from "./admin";
import type { Row } from "./tables";

export type RoutingChannelRow = Pick<
  Row<"channels">,
  | "id"
  | "tenant_id"
  | "provider"
  | "external_instance"
  | "phone"
  | "status"
  | "settings"
  | "webhook_token_hash"
>;

export type RoutingAgentRow = Pick<
  Row<"agent_configs">,
  "id" | "tenant_id" | "module_key" | "channel_id" | "status" | "config" | "config_version"
>;

export interface RoutingSnapshot {
  channels: RoutingChannelRow[];
  /** Solo agentes `active` u `observe`: los `paused` no reciben mensajes. */
  agents: RoutingAgentRow[];
}

/**
 * Lee lo necesario para la tabla de ruteo del worker (plan, 6.1): todos los canales y los
 * agentes que escuchan. Es una lectura entre tenants a propósito (el worker atiende a todos),
 * por eso vive aquí y no pasa por tenantTable().
 */
export async function loadRoutingSnapshot(db: AdminClient): Promise<RoutingSnapshot> {
  const [channels, agents] = await Promise.all([
    db
      .from("channels")
      .select(
        "id, tenant_id, provider, external_instance, phone, status, settings, webhook_token_hash",
      ),
    db
      .from("agent_configs")
      .select("id, tenant_id, module_key, channel_id, status, config, config_version")
      .in("status", ["active", "observe"]),
  ]);
  if (channels.error) throw new Error(`loadRoutingSnapshot(channels): ${channels.error.message}`);
  if (agents.error) throw new Error(`loadRoutingSnapshot(agent_configs): ${agents.error.message}`);
  return { channels: channels.data ?? [], agents: agents.data ?? [] };
}
