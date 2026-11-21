import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo: el trazado de archivos del build standalone parte de la raíz del repo.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@ravyn/core", "@ravyn/db"],
  poweredByHeader: false,
  reactStrictMode: true,
  // Sin optimizador de imágenes: el panel no lo necesita y reduce la superficie expuesta.
  images: { unoptimized: true },
};

export default nextConfig;
