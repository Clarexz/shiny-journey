import { describe, expect, it } from "vitest";
import { assertNever } from "./assert-never";

describe("assertNever", () => {
  it("lanza un error con el valor recibido", () => {
    expect(() => assertNever("x" as never)).toThrow('Valor no esperado: "x"');
  });
});
