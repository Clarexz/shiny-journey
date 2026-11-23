import { describe, expect, it } from "vitest";
import { LID_ALT_FIELDS, resolveSender } from "./sender";

describe("resolveSender (cascada de 5.4)", () => {
  it("1. JID de usuario: normaliza el teléfono", () => {
    expect(resolveSender("528991234567:3@s.whatsapp.net", {})).toEqual({
      jid: "528991234567:3@s.whatsapp.net",
      phone: "5218991234567",
      lid: null,
      source: "jid",
    });
  });

  it.each(LID_ALT_FIELDS)("2. @lid con el teléfono en key.%s", (field) => {
    expect(
      resolveSender("123456789012345@lid", { [field]: "528990001111@s.whatsapp.net" }),
    ).toEqual({
      jid: "123456789012345@lid",
      phone: "5218990001111",
      lid: "123456789012345",
      source: "payload_alt",
    });
  });

  it("2. respeta el orden de los campos alternos e ignora los que no son teléfono", () => {
    const r = resolveSender("123@lid", {
      participantAlt: "999@lid",
      remoteJidAlt: "5218990001111@s.whatsapp.net",
    });
    expect(r.phone).toBe("5218990001111");
  });

  it("2. un remoteJidAlt de grupo no se toma como teléfono", () => {
    expect(resolveSender("123@lid", { remoteJidAlt: "120363000000000001@g.us" })).toMatchObject({
      phone: null,
      source: "unresolved",
    });
  });

  it("2. los nombres de Baileys 6.x ya no se consultan", () => {
    expect(
      resolveSender("123@lid", {
        participantPn: "5218990001111@s.whatsapp.net",
        senderPn: "5218990002222@s.whatsapp.net",
      }).source,
    ).toBe("unresolved");
  });

  it("3. @lid sin campo alterno: usa el mapa en memoria", () => {
    const r = resolveSender("123@lid", {}, (lid) => (lid === "123" ? "528990003333" : null));
    expect(r).toMatchObject({ phone: "5218990003333", lid: "123", source: "lid_map" });
  });

  it("4. @lid sin mapeo: phone null", () => {
    expect(resolveSender("123@lid", {}, () => null)).toEqual({
      jid: "123@lid",
      phone: null,
      lid: "123",
      source: "unresolved",
    });
  });

  it("un JID que no es de usuario ni LID queda sin resolver", () => {
    expect(resolveSender("status@broadcast", {})).toMatchObject({
      phone: null,
      lid: null,
      source: "unresolved",
    });
  });
});
