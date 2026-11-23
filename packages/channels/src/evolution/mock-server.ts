/**
 * Servidor HTTP simulado de Evolution para las pruebas (T1.4). Registra cada solicitud
 * (método, ruta, query, encabezados y cuerpo) y responde según las rutas configuradas.
 */
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface MockReply {
  status?: number;
  body?: unknown;
  delayMs?: number;
}

export type MockHandler = (req: RecordedRequest) => MockReply | Promise<MockReply>;

export interface MockEvolution {
  url: string;
  requests: RecordedRequest[];
  /** Define la respuesta de `"POST /message/sendText/t-demo-1"`. */
  on(route: string, handler: MockHandler | MockReply): void;
  reset(): void;
  close(): Promise<void>;
}

export async function startMockEvolution(): Promise<MockEvolution> {
  const routes = new Map<string, MockHandler>();
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const raw = Buffer.concat(chunks).toString("utf8");
        const recorded: RecordedRequest = {
          method: req.method ?? "GET",
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers,
          body: raw === "" ? undefined : JSON.parse(raw),
        };
        requests.push(recorded);
        const handler = routes.get(`${recorded.method} ${recorded.path}`);
        const reply: MockReply = handler
          ? await handler(recorded)
          : { status: 404, body: { status: 404, error: "Not Found" } };
        if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
        if (res.destroyed) return;
        res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        res.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    on(route, handler) {
      routes.set(route, typeof handler === "function" ? handler : () => handler);
    },
    reset() {
      routes.clear();
      requests.length = 0;
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
  };
}

/** Respuesta típica de `sendText`. */
export function sendTextReply(id = "3EB0FAKE0000000001", number = "5218991234567") {
  return {
    status: 201,
    body: {
      key: { remoteJid: `${number}@s.whatsapp.net`, fromMe: true, id },
      message: { extendedTextMessage: { text: "..." } },
      messageTimestamp: "1762700401",
      status: "PENDING",
    },
  };
}

/** Respuesta de Evolution cuando el número no tiene WhatsApp. */
export function numberNotFoundReply(number: string) {
  return {
    status: 400,
    body: {
      status: 400,
      error: "Bad Request",
      response: { message: [{ exists: false, jid: `${number}@s.whatsapp.net`, number }] },
    },
  };
}
