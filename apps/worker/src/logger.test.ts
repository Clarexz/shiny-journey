import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, sanitizeUrl } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(line));
      cb();
    },
  });
  return { lines, stream, raw: () => JSON.stringify(lines) };
}

describe("logger", () => {
  it("redacta text y pushName en la raíz y en objetos anidados", () => {
    const out = capture();
    const log = createLogger({ destination: out.stream });
    log.info({ text: "busco cobertura reynosa 3", pushName: "Juan Pérez" }, "msg");
    log.info({ data: { pushName: "Ana", message: { conversation: "hola" } } }, "webhook");
    log.info({ inbound: { text: "paciente", participant: "521899@s.whatsapp.net" } }, "x");

    expect(out.lines[0]).toMatchObject({ text: REDACTED, pushName: REDACTED, service: "worker" });
    expect(out.lines[1]).toMatchObject({ data: { pushName: REDACTED, message: REDACTED } });
    expect(out.lines[2]).toMatchObject({ inbound: { text: REDACTED, participant: REDACTED } });
    for (const secret of ["busco cobertura", "Juan", "Ana", "hola", "paciente", "521899"]) {
      expect(out.raw()).not.toContain(secret);
    }
  });

  it("conserva err.message para depurar", () => {
    const out = capture();
    createLogger({ destination: out.stream }).error({ err: new Error("fallo de red") }, "x");
    expect(out.lines[0]).toMatchObject({ err: { message: "fallo de red" } });
  });
});

describe("sanitizeUrl", () => {
  it("oculta el token del webhook y la query", () => {
    expect(sanitizeUrl("/webhooks/evolution/abc/s3cr3t")).toBe(
      `/webhooks/evolution/abc/${REDACTED}`,
    );
    expect(sanitizeUrl("/webhooks/evolution/abc/s3cr3t/messages-upsert")).toBe(
      `/webhooks/evolution/abc/${REDACTED}/messages-upsert`,
    );
    expect(sanitizeUrl("/health?token=x")).toBe(`/health?${REDACTED}`);
    expect(sanitizeUrl("/health")).toBe("/health");
  });
});
