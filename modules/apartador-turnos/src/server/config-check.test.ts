import { describe, expect, it } from "vitest";
import { CATALOG, doctorConfig } from "../../test/helpers";
import { checkConfigAgainstCatalog } from "./config-check";

describe("checkConfigAgainstCatalog", () => {
  it("la configuración del doctor es coherente con el catálogo", () => {
    expect(checkConfigAgainstCatalog(doctorConfig(), CATALOG)).toEqual([]);
  });

  it("detecta claves que no existen o con otro número y alias que apuntan a la gemela", () => {
    const config = doctorConfig({
      branches: {
        accepted: [
          { number: 3, code: "S-0404", label: "Cumbres", aliases: ["benito juarez"] },
          { number: 4, code: "S-0404", label: "Error", aliases: [] },
          { number: 5, code: "S-9999", label: "No existe", aliases: [] },
        ],
      },
    });
    expect(checkConfigAgainstCatalog(config, CATALOG)).toEqual([
      {
        path: "branches.accepted.1.code",
        message: "S-0404 no es una sucursal Reynosa 4 del catálogo",
      },
      {
        path: "branches.accepted.2.code",
        message: "S-9999 no es una sucursal Reynosa 5 del catálogo",
      },
      {
        path: "branches.accepted.0.aliases",
        message: '"benito juarez" también identifica a otra Reynosa 3 (FC-1228)',
      },
    ]);
  });
});
