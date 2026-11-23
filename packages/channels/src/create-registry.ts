import { FakeAdapter, FakeOutbox } from "./fake/adapter";
import { dryRunDecorator } from "./dry-run";
import { EvolutionClient, type EvolutionClientOptions } from "./evolution/client";
import { EvolutionAdapter } from "./evolution/adapter";
import type { LidLookup } from "./evolution/sender";
import { ChannelRegistry, type ResolvedChannel } from "./registry";

export interface CreateChannelRegistryOptions {
  /** Valor de `CHANNEL_DRY_RUN`. */
  dryRun: boolean;
  /** Registro de envíos del modo dry-run y de los canales Fake. Se crea uno si no se pasa. */
  outbox?: FakeOutbox;
  /** Si se pasa, se registra el adaptador de Evolution con un cliente compartido. */
  evolution?: EvolutionClientOptions & {
    /** Secreto del encabezado del webhook por canal (opcional). */
    webhookSecret?: (channel: ResolvedChannel) => string | undefined;
    lidLookup?: (channel: ResolvedChannel) => LidLookup | undefined;
  };
}

/**
 * Registro con el adaptador Fake ya dado de alta y, si `dryRun`, con el envío sustituido para
 * todos los proveedores. Evolution se registra si se pasa su configuración; Meta Cloud llega en la
 * fase 2.
 */
export function createChannelRegistry(opts: CreateChannelRegistryOptions) {
  const outbox = opts.outbox ?? new FakeOutbox();
  const registry = new ChannelRegistry().register(
    "fake",
    (channel) =>
      new FakeAdapter({
        channelId: channel.id,
        tenantId: channel.tenantId,
        instance: channel.instance,
        status: channel.status,
        outbox,
      }),
  );
  if (opts.evolution) {
    const { webhookSecret, lidLookup, ...clientOptions } = opts.evolution;
    const client = new EvolutionClient(clientOptions);
    registry.register(
      "evolution",
      (channel) =>
        new EvolutionAdapter({
          client,
          channelId: channel.id,
          tenantId: channel.tenantId,
          instance: channel.instance,
          webhookSecret: webhookSecret?.(channel),
          lidLookup: lidLookup?.(channel),
        }),
    );
  }
  if (opts.dryRun) registry.decorate(dryRunDecorator(outbox));
  return { registry, outbox };
}
