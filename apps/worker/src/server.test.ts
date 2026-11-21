import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";
import { buildServer } from "./server";

const silent = createLogger({ level: "silent" });

describe("GET /health", () => {
  it("200 cuando Redis y la base responden", async () => {
    const app = buildServer({
      logger: silent,
      health: async () => ({ ok: true, redis: true, db: true }),
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, redis: true, db: true });
    await app.close();
  });

  it("503 si alguna dependencia falla", async () => {
    const app = buildServer({
      logger: silent,
      health: async () => ({ ok: false, redis: true, db: false }),
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, redis: true, db: false });
    await app.close();
  });

  it("el log de la petición no incluye headers ni el token de la URL", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const app = buildServer({
      logger: createLogger({ destination: stream }),
      health: async () => ({ ok: true, redis: true, db: true }),
    });
    await app.inject({
      method: "POST",
      url: "/webhooks/evolution/canal-1/token-secreto",
      headers: { authorization: "Bearer xyz" },
      payload: { data: { message: { conversation: "hola" } } },
    });
    const all = lines.join("");
    expect(all).toContain("/webhooks/evolution/canal-1/[redactado]");
    expect(all).not.toContain("token-secreto");
    expect(all).not.toContain("Bearer xyz");
    expect(all).not.toContain("hola");
    await app.close();
  });
});
