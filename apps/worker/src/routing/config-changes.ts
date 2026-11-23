import { CONFIG_CHANGED_CHANNEL } from "@ravyn/core";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { RoutingTable } from "./table";

export interface ConfigWatcherOptions {
  /** Conexión dedicada: una conexión en modo subscribe no acepta otros comandos. */
  subscriber: Redis;
  table: RoutingTable;
  logger: Logger;
  /** Recarga de respaldo por si se pierde un mensaje de pub/sub (ms; 0 la desactiva). */
  intervalMs?: number;
  /** Agrupa ráfagas de cambios (ms). */
  debounceMs?: number;
}

/**
 * Recarga la tabla de ruteo cuando llega `config:changed` (4.3) y, como respaldo, cada
 * `intervalMs`. Devuelve una función para detenerlo.
 */
export async function watchConfigChanges(opts: ConfigWatcherOptions): Promise<() => Promise<void>> {
  const { subscriber, table, logger, intervalMs = 5 * 60_000, debounceMs = 100 } = opts;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      table.reload().catch(() => {});
    }, debounceMs);
  };

  subscriber.on("message", (channel: string) => {
    if (channel === CONFIG_CHANGED_CHANNEL) schedule();
  });
  // Tras una reconexión se pudieron perder avisos: se recarga.
  subscriber.on("ready", schedule);
  await subscriber.subscribe(CONFIG_CHANGED_CHANNEL);
  logger.info({ channel: CONFIG_CHANGED_CHANNEL }, "ruteo: escuchando cambios de configuración");

  const interval = intervalMs > 0 ? setInterval(schedule, intervalMs) : null;
  interval?.unref();

  return async () => {
    if (interval) clearInterval(interval);
    if (timer) clearTimeout(timer);
    await subscriber.unsubscribe(CONFIG_CHANGED_CHANNEL).catch(() => {});
  };
}
