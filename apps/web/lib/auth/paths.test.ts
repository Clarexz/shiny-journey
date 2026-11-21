import { describe, expect, it } from "vitest";
import { isPublicPath, loginRedirectPath } from "./paths";

describe("loginRedirectPath", () => {
  it.each([
    [undefined, "/"],
    ["", "/"],
    ["/", "/"],
    ["/m/apartador-turnos?x=1", "/m/apartador-turnos?x=1"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["/login", "/"],
    ["/login?next=/x", "/"],
  ])("%s -> %s", (input, expected) => {
    expect(loginRedirectPath(input)).toBe(expected);
  });
});

describe("isPublicPath", () => {
  it("solo /login es pública", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
  });
});
