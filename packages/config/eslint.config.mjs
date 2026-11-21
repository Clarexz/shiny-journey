// Configuración base de ESLint (flat config) compartida por todo el monorepo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const ignores = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/coverage/**",
  "**/next-env.d.ts",
  "supabase/.temp/**",
  "packages/db/src/types.gen.ts",
];

/**
 * Tablas con `tenant_id`. Fuera de packages/db se accede a ellas con tenantTable(), nunca con
 * `.from("<tabla>")` directo. La lista vive en tenant-tables.json; una prueba en packages/db verifica que esta lista coincide con
 * TENANT_TABLES (que a su vez se valida contra los tipos generados).
 */
export const tenantTablesForLint = require("./tenant-tables.json");

const directFromSelector = `CallExpression[callee.property.name='from'][arguments.0.value=/^(${tenantTablesForLint.join("|")})$/]`;

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,js,mjs}"],
    ignores: ["packages/db/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: directFromSelector,
          message:
            "Tabla con tenant_id: usa tenantTable(ctx, tabla) de @ravyn/db en lugar de .from() directo.",
        },
      ],
    },
  },
);
