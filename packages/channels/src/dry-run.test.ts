import { describe, expect, it, vi } from "vitest";
import { createChannelRegistry } from "./create-registry";
import { withDryRun, isDryRunAdapter } from "./dry-run";
import { FakeAdapter, FakeOutbox } from "./fake/adapter";
import type { ChannelAdapter, ChannelRow } from "./types";

const row: ChannelRow = {
  id: "ch-1",
  tenant_id: "t-1",
  provider: "fake",
  external_instance: "t-demo-1",
  phone: null,
  status: "open",
  settings: {},
};

/** Adaptador "real" cuyo envío no debe llamarse nunca en dry-run. */
function realAdapter(): ChannelAdapter & { sendText: ReturnType<typeof vi.fn> } {
  const inner = new FakeAdapter({ channelId: "ch-1", tenantId: "t-1", status: "closed" });
  return Object.assign(inner, {
    sendText: vi.fn(async () => {
      throw new Error("envío real en dry-run");
    }),
  });
}

describe("dry-run", () => {
  it("sustituye solo sendText; el resto va al adaptador real", async () => {
    const real = realAdapter();
    const outbox = new FakeOutbox();
    const adapter = withDryRun(real, { id: "ch-1", tenantId: "t-1" }, outbox);

    const res = await adapter.sendText({
      to: { phone: "5218991234567" },
      text: "hola",
      idempotencyKey: "k1",
    });
    expect(res.providerMessageId).toMatch(/^fake-/);
    expect(real.sendText).not.toHaveBeenCalled();
    expect(outbox.sent).toHaveLength(1);

    // El estado es el del adaptador real (closed), no el del registro Fake.
    expect(await adapter.getStatus()).toBe("closed");
    expect(adapter.provider).toBe(real.provider);
    expect(adapter.capabilities).toBe(real.capabilities);
    await adapter.restart();
    expect((real as unknown as FakeAdapter).calls.map((c) => c.method)).toEqual(["restart"]);
    expect(isDryRunAdapter(adapter)).toBe(true);
    expect(isDryRunAdapter(real)).toBe(false);
  });

  it("sigue validando la entrada de sendText", async () => {
    const adapter = withDryRun(realAdapter(), { id: "ch-1", tenantId: "t-1" }, new FakeOutbox());
    await expect(
      adapter.sendText({ to: {}, text: "hola", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("createChannelRegistry aplica dry-run según CHANNEL_DRY_RUN", async () => {
    const on = createChannelRegistry({ dryRun: true });
    expect(isDryRunAdapter(on.registry.create(row))).toBe(true);
    await on.registry
      .create(row)
      .sendText({ to: { phone: "5218991234567" }, text: "x", idempotencyKey: "k" });
    expect(on.outbox.sent).toHaveLength(1);

    const off = createChannelRegistry({ dryRun: false });
    expect(isDryRunAdapter(off.registry.create(row))).toBe(false);
  });
});
