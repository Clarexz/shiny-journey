import { FakeAdapter, FakeOutbox } from "./fake/adapter";
import { dryRunDecorator } from "./dry-run";
import { ChannelRegistry } from "./registry";

export interface CreateChannelRegistryOptions {
  /** Valor de `CHANNEL_DRY_RUN`. */
  dryRun: boolean;
  /** Registro de envíos del modo dry-run y de los canales Fake. Se crea uno si no se pasa. */
  outbox?: FakeOutbox;
}

/**
 * Registro con el adaptador Fake ya dado de alta y, si `dryRun`, con el envío sustituido para
 * todos los proveedores. Evolution se registra en T1.4 y Meta Cloud en la fase 2.
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
  if (opts.dryRun) registry.decorate(dryRunDecorator(outbox));
  return { registry, outbox };
}
