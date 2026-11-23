import { ModuleRegistry } from "@ravyn/core";
import { echoModule } from "@ravyn/core/testing";
import type { RoutingSnapshot } from "@ravyn/db";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger";
import { RoutingTable, buildRoutes } from "./table";

const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";
const modules = new ModuleRegistry([echoModule]);
const logger = createLogger({ level: "silent" });

const channel = (id: string) => ({
  id,
  tenant_id: "t-1",
  provider: "evolution",
  external_instance: `inst-${id}`,
  phone: null,
  status: "open",
  settings: {},
  webhook_token_hash: "a".repeat(64),
});
const agent = (id: string, channelId: string, config: unknown, moduleKey = "echo") => ({
  id,
  tenant_id: "t-1",
  module_key: moduleKey,
  channel_id: channelId,
  status: "active",
  config: config as never,
  config_version: 1,
});

describe("buildRoutes", () => {
  it("agrupa los agentes por canal y JID", () => {
    const snap: RoutingSnapshot = {
      channels: [channel("c1"), channel("c2")],
      agents: [
        agent("a1", "c1", { groupJids: [G1] }),
        agent("a2", "c1", { groupJids: [G1, G2] }),
        agent("a3", "c2", { groupJids: [] }),
      ],
    };
    const { routes, stats } = buildRoutes(snap, modules);
    expect(Object.fromEntries(routes.get("c1")!.groupJids)).toEqual({
      [G1]: ["a1", "a2"],
      [G2]: ["a2"],
    });
    expect(routes.get("c2")!.groupJids.size).toBe(0);
    expect(routes.get("c1")!.row).toMatchObject({ id: "c1", external_instance: "inst-c1" });
    expect(stats).toEqual({ channels: 2, agents: 3, skippedAgents: 0, groupJids: 2 });
  });

  it("omite agentes con módulo desconocido o config inválido sin romper la tabla", () => {
    const warn = vi.fn();
    const { routes, stats } = buildRoutes(
      {
        channels: [channel("c1")],
        agents: [
          agent("ok", "c1", { groupJids: [G1] }),
          agent("mal", "c1", { groupJids: ["no-es-grupo"] }),
          agent("otro", "c1", {}, "modulo_que_no_existe"),
        ],
      },
      modules,
      { warn },
    );
    expect(Object.fromEntries(routes.get("c1")!.groupJids)).toEqual({ [G1]: ["ok"] });
    expect(stats.skippedAgents).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("no-es-grupo");
  });
});

describe("RoutingTable", () => {
  it("recarga y conserva la tabla anterior si la carga falla", async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error("base caída");
      return { channels: [channel("c1")], agents: [agent("a1", "c1", { groupJids: [G1] })] };
    });
    const table = new RoutingTable({ load, modules, logger });
    expect(table.isLoaded).toBe(false);
    await table.reload();
    expect(table.get("c1")?.groupJids.get(G1)).toEqual(["a1"]);
    fail = true;
    await expect(table.reload()).rejects.toThrow("base caída");
    expect(table.get("c1")?.groupJids.get(G1)).toEqual(["a1"]);
  });

  it("agrupa recargas concurrentes en una en curso más una al final", async () => {
    let resolve!: () => void;
    const load = vi.fn(
      () =>
        new Promise<RoutingSnapshot>((r) => {
          resolve = () => r({ channels: [], agents: [] });
        }),
    );
    const table = new RoutingTable({ load, modules, logger });
    const a = table.reload();
    const b = table.reload();
    const c = table.reload();
    resolve();
    await Promise.all([a, b, c]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    resolve();
  });
});
