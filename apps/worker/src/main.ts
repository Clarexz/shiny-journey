import { ModuleRegistry } from "@ravyn/core";
import { createAdminClient, loadRoutingSnapshot } from "@ravyn/db";
import { composeWorker } from "./compose";
import { EnvError, loadEnv } from "./env";
import { createHealthCheck } from "./health";
import { createLogger } from "./logger";
import { closeQueues, createQueues, QUEUE_NAMES } from "./queues";
import { createRedis } from "./redis";
import { watchConfigChanges } from "./routing/config-changes";

async function main() {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });

  const redis = createRedis(env.REDIS_URL, "worker");
  redis.on("error", (err) =>
    logger.warn({ err: { message: err.message } }, "redis: error de conexión"),
  );

  const db = createAdminClient({
    url: env.SUPABASE_INTERNAL_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });

  const queues = createQueues(redis);
  logger.info({ queues: QUEUE_NAMES, dryRun: env.CHANNEL_DRY_RUN }, "colas declaradas");

  // Módulos registrados: el Apartador se agrega cuando tenga su pipeline (T1.15). Sin
  // módulos, nada queda suscrito y todo webhook de mensaje se descarta en memoria.
  const modules = new ModuleRegistry([]);

  // Canales: Fake siempre; Evolution si está configurado. CHANNEL_DRY_RUN sustituye el envío.
  const { app, routing } = await composeWorker({
    logger,
    redis,
    queues,
    loadRouting: () => loadRoutingSnapshot(db),
    modules,
    dryRun: env.CHANNEL_DRY_RUN,
    evolution:
      env.EVOLUTION_BASE_URL && env.EVOLUTION_API_KEY
        ? { baseUrl: env.EVOLUTION_BASE_URL, apiKey: env.EVOLUTION_API_KEY }
        : undefined,
    health: createHealthCheck({ redis, db }),
  });
  const subscriber = createRedis(env.REDIS_URL, "worker-config-sub");
  subscriber.on("error", (err) =>
    logger.warn({ err: { message: err.message } }, "redis (sub): error de conexión"),
  );
  const stopWatching = await watchConfigChanges({ subscriber, table: routing, logger });

  await app.listen({ port: env.PORT, host: env.HOST });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "apagando");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      await stopWatching();
      await subscriber.quit();
      await closeQueues(queues);
      await redis.quit();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "error al apagar");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  if (err instanceof EnvError) {
    console.error(err.message);
  } else {
    console.error("worker: error al arrancar", err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
