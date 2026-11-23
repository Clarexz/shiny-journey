import { describe, expect, it } from "vitest";
import {
  isGroupJid,
  isLidJid,
  lidFromJid,
  lidToJid,
  maskPhone,
  normalizePhone,
  parseJid,
  phoneSendVariants,
  phoneToJid,
  samePhone,
} from "./phone";

describe("normalizePhone", () => {
  it.each([
    // México: 52 frente a 521
    ["5218991234567", "5218991234567"],
    ["528991234567", "5218991234567"],
    ["+52 899 123 4567", "5218991234567"],
    ["+52 1 899 123 4567", "5218991234567"],
    ["+52 (899) 123-45-67", "5218991234567"],
    ["52.899.123.4567", "5218991234567"],
    // Sufijos y dispositivo
    ["5218991234567@s.whatsapp.net", "5218991234567"],
    ["528991234567@s.whatsapp.net", "5218991234567"],
    ["5218991234567@c.us", "5218991234567"],
    ["5218991234567:12@s.whatsapp.net", "5218991234567"],
    ["5218991234567:3", "5218991234567"],
    ["  5218991234567@S.WHATSAPP.NET ", "5218991234567"],
    // Otros países se dejan igual
    ["14155552671", "14155552671"],
    ["+34 612 34 56 78", "34612345678"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["123456789012345@lid"],
    ["123456789012345:4@lid"],
    ["120363000000000001@g.us"],
    ["status@broadcast"],
    ["12345@newsletter"],
    ["abc"],
    ["52899abc4567"],
    ["1234567"],
    ["1234567890123456"],
    [""],
  ])("%s no es un teléfono", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("null y undefined dan null", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("10 dígitos solo se interpretan como México si se pide", () => {
    expect(normalizePhone("899 123 4567")).toBe("8991234567");
    expect(normalizePhone("899 123 4567", { defaultCountry: "MX" })).toBe("5218991234567");
    expect(normalizePhone("528991234567", { defaultCountry: "MX" })).toBe("5218991234567");
  });

  it("es idempotente", () => {
    for (const p of ["528991234567", "+52 1 899 123 4567", "14155552671"]) {
      const once = normalizePhone(p);
      expect(normalizePhone(once)).toBe(once);
    }
  });

  it("cumple el CHECK channels_phone_format", () => {
    for (const p of ["528991234567", "14155552671", "34612345678"]) {
      expect(normalizePhone(p)).toMatch(/^[0-9]{8,15}$/);
    }
  });
});

describe("JIDs", () => {
  it("parseJid distingue usuario, LID, grupo y otros", () => {
    expect(parseJid("5218991234567:2@s.whatsapp.net")).toEqual({
      user: "5218991234567",
      device: "2",
      server: "s.whatsapp.net",
      kind: "user",
    });
    expect(parseJid("123456789012345@lid").kind).toBe("lid");
    expect(parseJid("120363000000000001@g.us").kind).toBe("group");
    expect(parseJid("status@broadcast").kind).toBe("other");
    expect(parseJid("5218991234567")).toMatchObject({ server: null, kind: "user" });
  });

  it("isGroupJid e isLidJid", () => {
    expect(isGroupJid("120363000000000001@g.us")).toBe(true);
    expect(isGroupJid("5218991234567@s.whatsapp.net")).toBe(false);
    expect(isLidJid("123456789012345@lid")).toBe(true);
    expect(isLidJid("5218991234567@s.whatsapp.net")).toBe(false);
  });

  it("lidFromJid quita sufijo y dispositivo", () => {
    expect(lidFromJid("123456789012345@lid")).toBe("123456789012345");
    expect(lidFromJid("123456789012345:7@lid")).toBe("123456789012345");
    expect(lidFromJid("5218991234567@s.whatsapp.net")).toBeNull();
    expect(lidFromJid("abc@lid")).toBeNull();
    expect(lidFromJid(null)).toBeNull();
  });

  it("phoneToJid y lidToJid", () => {
    expect(phoneToJid("5218991234567")).toBe("5218991234567@s.whatsapp.net");
    expect(lidToJid("123456789012345")).toBe("123456789012345@lid");
    expect(normalizePhone(phoneToJid("5218991234567"))).toBe("5218991234567");
    expect(lidFromJid(lidToJid("123456789012345"))).toBe("123456789012345");
  });
});

describe("envío y comparación", () => {
  it("phoneSendVariants prueba primero con el 1 y luego sin él (México)", () => {
    expect(phoneSendVariants("5218991234567")).toEqual(["5218991234567", "528991234567"]);
    expect(phoneSendVariants("14155552671")).toEqual(["14155552671"]);
  });

  it("samePhone compara por forma canónica", () => {
    expect(samePhone("528991234567@s.whatsapp.net", "+52 1 899 123 4567")).toBe(true);
    expect(samePhone("5218991234567", "5218991234568")).toBe(false);
    expect(samePhone("123@lid", "123@lid")).toBe(false);
    expect(samePhone(null, null)).toBe(false);
  });

  it("maskPhone oculta la parte central", () => {
    expect(maskPhone("5218991234567")).toBe("521******4567");
    expect(maskPhone("1234567")).toBe("*******");
    expect(maskPhone(null)).toBe("");
  });
});
