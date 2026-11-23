import Fastify from "fastify";
import type { Logger } from "pino";
import type { HealthCheck } from "./health";
import { registerWebhookRoutes, type WebhookDeps } from "./webhooks/route";

export interface ServerDeps {
  logger: Logger;
  health: HealthCheck;
  /** Sin esto no se registran las rutas de webhooks (pruebas de /health). */
  webhooks?: WebhookDeps;
}

export function buildServer({ logger, health, webhooks }: ServerDeps) {
  const app = Fastify({
    loggerInstance: logger,
    // Los serializadores req/res del logger (logger.ts) registran solo método, URL saneada y
    // código de respuesta: nunca headers ni body (los webhooks traen contenido de mensajes).
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });

  // El healthcheck de Docker llama cada 15 s: no se registra salvo que falle.
  app.get("/health", { logLevel: "warn" }, async (_req, reply) => {
    const status = await health();
    return reply.code(status.ok ? 200 : 503).send(status);
  });

  if (webhooks) registerWebhookRoutes(app, webhooks);

  // El manejador 404 por defecto registra la URL cruda (con el token del webhook).
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "No encontrado" }));

  return app;
}
