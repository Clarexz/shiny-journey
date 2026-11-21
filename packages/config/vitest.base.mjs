// Opciones base de Vitest compartidas por los proyectos del monorepo.
export const baseTestOptions = {
  environment: "node",
  include: ["src/**/*.test.ts", "test/**/*.test.ts", "lib/**/*.test.ts", "scripts/**/*.test.ts"],
  restoreMocks: true,
  testTimeout: 10_000,
};
