import path from "node:path";
import { defineProject } from "vitest/config";
import { baseTestOptions } from "@ravyn/config/vitest";

export default defineProject({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // "server-only" lanza fuera de un Server Component; en pruebas es un módulo vacío.
      "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts"),
    },
  },
  test: { name: "web", ...baseTestOptions },
});
