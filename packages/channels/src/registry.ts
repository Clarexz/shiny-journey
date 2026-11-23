import {
  ChannelError,
  isChannelStatus,
  isProvider,
  type ChannelAdapter,
  type ChannelCapability,
  type ChannelRow,
  type ChannelStatus,
  type Provider,
} from "./types";

/** Fila de `channels` ya validada, lo que recibe cada fábrica de adaptadores. */
export interface ResolvedChannel {
  id: string;
  tenantId: string;
  provider: Provider;
  /** `external_instance`: instancia de Evolution o `phone_number_id` de Meta. */
  instance: string;
  phone: string | null;
  status: ChannelStatus;
  settings: Record<string, unknown>;
}

export type AdapterFactory = (channel: ResolvedChannel) => ChannelAdapter;

/** Transforma el adaptador recién construido (por ejemplo, para el modo dry-run de T1.2). */
export type AdapterDecorator = (
  adapter: ChannelAdapter,
  channel: ResolvedChannel,
) => ChannelAdapter;

export function resolveChannelRow(row: ChannelRow): ResolvedChannel {
  if (!isProvider(row.provider)) {
    throw new ChannelError("invalid_input", `Proveedor de canal desconocido: ${row.provider}`);
  }
  if (!isChannelStatus(row.status)) {
    throw new ChannelError("invalid_input", `Estado de canal desconocido: ${row.status}`);
  }
  const settings =
    row.settings !== null && typeof row.settings === "object" && !Array.isArray(row.settings)
      ? (row.settings as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    instance: row.external_instance,
    phone: row.phone,
    status: row.status,
    settings,
  };
}

/**
 * Construye el adaptador de un canal a partir de su fila de `channels` (plan, 5.1).
 *
 * Cada proveedor registra una fábrica. `get()` guarda el adaptador por canal para no
 * reconstruirlo en cada webhook; `evict()` lo descarta cuando cambia la fila (reconexión,
 * cambio de instancia o de ajustes).
 */
export class ChannelRegistry {
  private readonly factories = new Map<Provider, AdapterFactory>();
  private readonly decorators: AdapterDecorator[] = [];
  private readonly cache = new Map<string, { key: string; adapter: ChannelAdapter }>();

  register(provider: Provider, factory: AdapterFactory): this {
    if (this.factories.has(provider)) {
      throw new ChannelError("invalid_input", `Proveedor ya registrado: ${provider}`);
    }
    this.factories.set(provider, factory);
    this.cache.clear();
    return this;
  }

  /** Agrega un decorador que se aplica a todos los adaptadores que se construyan después. */
  decorate(decorator: AdapterDecorator): this {
    this.decorators.push(decorator);
    this.cache.clear();
    return this;
  }

  has(provider: Provider): boolean {
    return this.factories.has(provider);
  }

  providers(): Provider[] {
    return [...this.factories.keys()];
  }

  /** Construye un adaptador nuevo, sin caché. */
  create(row: ChannelRow): ChannelAdapter {
    const channel = resolveChannelRow(row);
    const factory = this.factories.get(channel.provider);
    if (!factory) {
      throw new ChannelError(
        "unsupported",
        `No hay adaptador registrado para el proveedor ${channel.provider}`,
        { provider: channel.provider },
      );
    }
    let adapter = factory(channel);
    if (adapter.provider !== channel.provider) {
      throw new ChannelError(
        "invalid_input",
        `La fábrica de ${channel.provider} devolvió un adaptador de ${adapter.provider}`,
        { provider: channel.provider },
      );
    }
    for (const decorator of this.decorators) adapter = decorator(adapter, channel);
    return adapter;
  }

  /**
   * Adaptador en caché para el canal. Se reconstruye si cambió el proveedor, la instancia o
   * los ajustes de la fila.
   */
  get(row: ChannelRow): ChannelAdapter {
    const key = cacheKey(row);
    const hit = this.cache.get(row.id);
    if (hit && hit.key === key) return hit.adapter;
    const adapter = this.create(row);
    this.cache.set(row.id, { key, adapter });
    return adapter;
  }

  evict(channelId: string): void {
    this.cache.delete(channelId);
  }

  clear(): void {
    this.cache.clear();
  }
}

function cacheKey(row: ChannelRow): string {
  return JSON.stringify([row.provider, row.external_instance, row.tenant_id, row.settings ?? {}]);
}

/** Capacidades que faltan en el adaptador (vacío si las tiene todas). */
export function missingCapabilities(
  adapter: Pick<ChannelAdapter, "capabilities">,
  required: Iterable<ChannelCapability>,
): ChannelCapability[] {
  return [...new Set(required)].filter((c) => !adapter.capabilities.has(c));
}

/**
 * Falla con `unsupported` si el canal no puede hacer lo que el módulo necesita
 * (por ejemplo, activar el Apartador sobre Meta Cloud, que no lee grupos).
 */
export function assertCapabilities(
  adapter: Pick<ChannelAdapter, "capabilities" | "provider">,
  required: Iterable<ChannelCapability>,
): void {
  const missing = missingCapabilities(adapter, required);
  if (missing.length > 0) {
    throw new ChannelError("unsupported", `El canal no tiene: ${missing.join(", ")}`, {
      provider: adapter.provider,
      retryable: false,
    });
  }
}
