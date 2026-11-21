import { createAdminClient } from "@ravyn/db";
import { EnvError, loadEnv } from "./env";
import { createHealthCheck } from "./health";
import { createLogger } from "./logger";
import { closeQueues, createQueues, QUEUE_NAMES } from "./queues";
import { createRedis } from "./redis";
import { buildServer } from "./server";

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

  const app = buildServer({ logger, health: createHealthCheck({ redis, db }) });
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
