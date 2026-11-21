import { defineConfig } from "vitest/config";

// Cada workspace con pruebas declara su propio vitest.config.mts.
export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.mts",
      "apps/*/vitest.config.mts",
      "modules/*/vitest.config.mts",
    ],
  },
});
