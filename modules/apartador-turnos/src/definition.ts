/**
 * Definición del módulo Apartador de turnos (plan, 4.1).
 *
 * El pipeline de servidor (`server()`) se completa en T1.15. Mientras tanto el worker no
 * registra este módulo en producción; el harness (T1.16) sí, para rutear el grupo objetivo.
 */
import { defineModule } from "@ravyn/core";
import { ApartadorConfigSchema, defaultApartadorConfig, type ApartadorConfig } from "./config";

export const APARTADOR_KEY = "apartador_turnos";

export const apartadorTurnos = defineModule<ApartadorConfig>({
  key: APARTADOR_KEY,
  version: "1.0.0",
  kind: "agent",
  displayName: "Apartador de turnos",
  description:
    "Lee el grupo de coberturas y, cuando aparece un turno que te sirve, le escribe al publicador en segundos.",
  configSchema: ApartadorConfigSchema,
  defaultConfig: () => defaultApartadorConfig(),
  requiredCapabilities: ["read_groups", "send_direct"],
  triggers: (config) =>
    config.groupJid ? [{ type: "message.group", chatJids: [config.groupJid] }] : [],
  server: async () => {
    throw new Error("apartador_turnos: el pipeline de servidor llega en T1.15");
  },
});
