import { ModuleRegistry } from "@ravyn/core";
import { describe, expect, it } from "vitest";
import { DOCTOR_ACCEPTED } from "../fixtures/doctor-accepted";
import { apartadorTurnos } from "./definition";
import { uiManifest } from "./ui/manifest";

describe("definición del Apartador", () => {
  it("se registra y sus disparadores salen del grupo del config", () => {
    const registry = new ModuleRegistry([apartadorTurnos]);
    const def = registry.defaultConfig("apartador_turnos", { tenantTimezone: "America/Matamoros" });
    expect(registry.triggers("apartador_turnos", def)).toEqual([]);
    expect(
      registry.triggers("apartador_turnos", {
        groupJid: "120363000000000001@g.us",
        branches: { accepted: DOCTOR_ACCEPTED },
      }),
    ).toEqual([{ type: "message.group", chatJids: ["120363000000000001@g.us"] }]);
    expect(uiManifest.key).toBe(apartadorTurnos.key);
  });

  it("no se puede activar en un canal sin lectura de grupos (Meta Cloud)", () => {
    const registry = new ModuleRegistry([apartadorTurnos]);
    expect(
      registry.missingCapabilities("apartador_turnos", { capabilities: new Set(["send_direct"]) }),
    ).toEqual(["read_groups"]);
  });
});
