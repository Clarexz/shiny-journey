import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "./env";

const minimal = {
  SUPABASE_INTERNAL_URL: "http://supabase-kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  REDIS_URL: "redis://redis:6379/0",
};

describe("loadEnv", () => {
  it("aplica valores por defecto", () => {
    const env = loadEnv(minimal);
    expect(env).toMatchObject({ PORT: 3001, LOG_LEVEL: "info", CHANNEL_DRY_RUN: false });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("interpreta CHANNEL_DRY_RUN y vacíos como no definidos", () => {
    const env = loadEnv({ ...minimal, CHANNEL_DRY_RUN: "true", ANTHROPIC_API_KEY: "" });
    expect(env.CHANNEL_DRY_RUN).toBe(true);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("falla nombrando la variable sin mostrar valores", () => {
    const bad = { ...minimal, REDIS_URL: "http://nope", SUPABASE_SERVICE_ROLE_KEY: "" };
    expect(() => loadEnv(bad)).toThrow(EnvError);
    try {
      loadEnv(bad);
    } catch (err) {
      expect((err as Error).message).toContain("REDIS_URL");
      expect((err as Error).message).toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect((err as Error).message).not.toContain("http://nope");
    }
  });
});
