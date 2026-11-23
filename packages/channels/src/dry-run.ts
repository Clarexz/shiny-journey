import type { FakeOutbox } from "./fake/adapter";
import { FakeAdapter } from "./fake/adapter";
import type { AdapterDecorator, ResolvedChannel } from "./registry";
import type { ChannelAdapter, SendTextInput, SendTextResult } from "./types";

/**
 * Modo dry-run (`CHANNEL_DRY_RUN=true`, plan 5.7): el envío real se sustituye por el registro
 * en memoria del adaptador Fake, en cualquier entorno donde esté puesta la variable.
 *
 * Solo cambia `sendText`. La entrada, el estado y la administración de la sesión siguen
 * yendo al proveedor real, para que el harness en staging vea la sesión de verdad sin que
 * salga ningún mensaje.
 */
export function withDryRun(
  adapter: ChannelAdapter,
  channel: Pick<ResolvedChannel, "id" | "tenantId">,
  outbox: FakeOutbox,
): ChannelAdapter {
  const sink = new FakeAdapter({
    channelId: channel.id,
    tenantId: channel.tenantId,
    outbox,
    status: "open",
  });
  return new DryRunAdapter(adapter, sink);
}

/** Decorador para `ChannelRegistry.decorate()`. */
export function dryRunDecorator(outbox: FakeOutbox): AdapterDecorator {
  return (adapter, channel) => withDryRun(adapter, channel, outbox);
}

export function isDryRunAdapter(adapter: ChannelAdapter): boolean {
  return adapter instanceof DryRunAdapter;
}

class DryRunAdapter implements ChannelAdapter {
  constructor(
    private readonly inner: ChannelAdapter,
    private readonly sink: FakeAdapter,
  ) {}

  get provider() {
    return this.inner.provider;
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  parseWebhook(raw: unknown, headers: Record<string, string>) {
    return this.inner.parseWebhook(raw, headers);
  }

  verifyWebhook(raw: Buffer, headers: Record<string, string>, secret: string) {
    return this.inner.verifyWebhook(raw, headers, secret);
  }

  sendText(input: SendTextInput): Promise<SendTextResult> {
    return this.sink.sendText(input);
  }

  createSession(opts: { instance: string; webhookUrl: string }) {
    return this.inner.createSession(opts);
  }

  connect(opts: { pairingPhone?: string }) {
    return this.inner.connect(opts);
  }

  getStatus() {
    return this.inner.getStatus();
  }

  restart() {
    return this.inner.restart();
  }

  logout() {
    return this.inner.logout();
  }

  listGroups() {
    return this.inner.listGroups();
  }

  getGroupParticipants(jid: string) {
    return this.inner.getGroupParticipants(jid);
  }
}
