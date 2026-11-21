// Configuración base de ESLint (flat config) compartida por todo el monorepo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export const ignores = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/coverage/**",
  "**/next-env.d.ts",
  "supabase/.temp/**",
  "packages/db/src/types.gen.ts",
];

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
);
