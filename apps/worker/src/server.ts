import Fastify from "fastify";
import type { Logger } from "pino";
import type { HealthCheck } from "./health";

export interface ServerDeps {
  logger: Logger;
  health: HealthCheck;
}

export function buildServer({ logger, health }: ServerDeps) {
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

  // El manejador 404 por defecto registra la URL cruda (con el token del webhook).
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "No encontrado" }));

  return app;
}
