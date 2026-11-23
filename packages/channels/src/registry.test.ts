import { describe, expect, it, vi } from "vitest";
import { FakeAdapter } from "./fake/adapter";
import {
  ChannelRegistry,
  assertCapabilities,
  missingCapabilities,
  resolveChannelRow,
} from "./registry";
import { ChannelError, type ChannelRow } from "./types";

const row = (over: Partial<ChannelRow> = {}): ChannelRow => ({
  id: "ch-1",
  tenant_id: "t-1",
  provider: "fake",
  external_instance: "t-demo-1",
  phone: null,
  status: "open",
  settings: {},
  ...over,
});

const fakeFactory = vi.fn(
  (c: { id: string; tenantId: string; instance: string }) =>
    new FakeAdapter({ channelId: c.id, tenantId: c.tenantId, instance: c.instance }),
);

describe("resolveChannelRow", () => {
  it("valida proveedor y estado y normaliza settings", () => {
    expect(resolveChannelRow(row({ settings: null }))).toEqual({
      id: "ch-1",
      tenantId: "t-1",
      provider: "fake",
      instance: "t-demo-1",
      phone: null,
      status: "open",
      settings: {},
    });
    expect(() => resolveChannelRow(row({ provider: "twilio" }))).toThrow(ChannelError);
    expect(() => resolveChannelRow(row({ status: "zombie" }))).toThrow(/Estado/);
  });
});

describe("ChannelRegistry", () => {
  it("construye el adaptador del proveedor de la fila", () => {
    const registry = new ChannelRegistry().register("fake", fakeFactory);
    const adapter = registry.create(row());
    expect(adapter.provider).toBe("fake");
    expect((adapter as FakeAdapter).instance).toBe("t-demo-1");
    expect(registry.has("fake")).toBe(true);
    expect(registry.has("evolution")).toBe(false);
    expect(registry.providers()).toEqual(["fake"]);
  });

  it("falla con unsupported si el proveedor no está registrado", () => {
    const registry = new ChannelRegistry();
    const err = (() => {
      try {
        registry.create(row({ provider: "evolution" }));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ChannelError);
    expect((err as ChannelError).code).toBe("unsupported");
  });

  it("no permite registrar dos veces el mismo proveedor", () => {
    const registry = new ChannelRegistry().register("fake", fakeFactory);
    expect(() => registry.register("fake", fakeFactory)).toThrow(/ya registrado/);
  });

  it("rechaza una fábrica que devuelve otro proveedor", () => {
    const registry = new ChannelRegistry().register("evolution", fakeFactory);
    expect(() => registry.create(row({ provider: "evolution" }))).toThrow(/devolvió/);
  });

  it("get() guarda en caché por canal y reconstruye si cambia la fila", () => {
    fakeFactory.mockClear();
    const registry = new ChannelRegistry().register("fake", fakeFactory);
    const a = registry.get(row());
    expect(registry.get(row())).toBe(a);
    expect(registry.get(row({ status: "closed" }))).toBe(a);
    const b = registry.get(row({ external_instance: "t-demo-2" }));
    expect(b).not.toBe(a);
    const c = registry.get(row({ external_instance: "t-demo-2", settings: { maxPerHour: 3 } }));
    expect(c).not.toBe(b);
    registry.evict("ch-1");
    expect(
      registry.get(row({ external_instance: "t-demo-2", settings: { maxPerHour: 3 } })),
    ).not.toBe(c);
    expect(fakeFactory).toHaveBeenCalledTimes(4);
  });

  it("aplica los decoradores en orden", () => {
    const seen: string[] = [];
    const registry = new ChannelRegistry()
      .register("fake", fakeFactory)
      .decorate((a, c) => (seen.push(`1:${c.id}`), a))
      .decorate((a) => (seen.push("2"), a));
    registry.create(row());
    expect(seen).toEqual(["1:ch-1", "2"]);
  });
});

describe("capacidades", () => {
  const adapter = new FakeAdapter({
    channelId: "ch-1",
    tenantId: "t-1",
    capabilities: ["send_direct", "typing_indicator"],
  });

  it("missingCapabilities lista las que faltan, sin repetir", () => {
    expect(missingCapabilities(adapter, ["send_direct"])).toEqual([]);
    expect(missingCapabilities(adapter, ["read_groups", "send_direct", "read_groups"])).toEqual([
      "read_groups",
    ]);
  });

  it("assertCapabilities falla con unsupported", () => {
    expect(() => assertCapabilities(adapter, ["send_direct", "typing_indicator"])).not.toThrow();
    try {
      assertCapabilities(adapter, ["read_groups"]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChannelError);
      expect((e as ChannelError).code).toBe("unsupported");
      expect((e as ChannelError).retryable).toBe(false);
    }
  });
});
