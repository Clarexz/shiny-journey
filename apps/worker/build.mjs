// Empaqueta el worker en un solo archivo (dist/main.mjs) con todas sus dependencias, para que
// la imagen de Docker no necesite node_modules.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  legalComments: "none",
  // Algunas dependencias CommonJS usan require() de módulos nativos de Node.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
