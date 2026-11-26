/** Navegación del módulo en el panel (plan, 4.1 y 4.4). Seguro para el cliente. */
import type { ModuleUiManifest } from "@ravyn/core";

export const uiManifest: ModuleUiManifest = {
  key: "apartador_turnos",
  nav: [
    { href: "/m/apartador-turnos", label: "Turnos", icon: "CalendarCheck" },
    { href: "/m/apartador-turnos/disponibilidad", label: "Disponibilidad", icon: "CalendarDays" },
    { href: "/m/apartador-turnos/historial", label: "Historial", icon: "History" },
    {
      href: "/m/apartador-turnos/configuracion",
      label: "Configuración",
      icon: "SlidersHorizontal",
    },
  ],
};
