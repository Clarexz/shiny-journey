/**
 * Los 5 mensajes reales del grupo que compartió el doctor (plan, 7.6 y 7.7), con la hora de
 * referencia de cada uno (America/Matamoros) y lo que se espera extraer.
 */
import type { Shift } from "../src/server/shift";

export interface RealMessage {
  id: string;
  text: string;
  /** Hora local de referencia, ISO con offset de Matamoros. */
  at: string;
  expected: {
    branchNumbers: number[];
    branchCode: string | null;
    branchStatus: "resuelta" | "ambigua" | "desconocida";
    acceptance: "aceptada" | "no_aceptada" | "mixta" | "desconocida";
    shift: Shift | null;
    dates: string[];
    decision: "APARTAR" | "NOTIFICAR" | "DESCARTAR";
    reason: string;
  };
}

export const REAL_MESSAGES: RealMessage[] = [
  {
    id: "juarez-13",
    text: "Buenas tardes solicito.cobertura el día de hoy para reynosa 13,en turno vespertino en la.juarez 2",
    at: "2026-11-12T13:05:00-06:00",
    expected: {
      branchNumbers: [13],
      branchCode: null,
      branchStatus: "ambigua",
      acceptance: "no_aceptada",
      shift: "vespertino",
      dates: ["2026-11-12"],
      decision: "DESCARTAR",
      reason: "sucursal_no_aceptada",
    },
  },
  {
    id: "piramides-52",
    text: "Buenas tardes busco cobertura domingo 15 noviembre, Reynosa 52 pirámides ambos turnos",
    at: "2026-11-11T18:30:00-06:00",
    expected: {
      branchNumbers: [52],
      branchCode: "F-8013",
      branchStatus: "resuelta",
      acceptance: "no_aceptada",
      shift: "ambos",
      dates: ["2026-11-15"],
      decision: "DESCARTAR",
      reason: "sucursal_no_aceptada",
    },
  },
  {
    id: "jueves-viernes-53",
    text: "Busco cobertura para este jueves y viernes turno matutino reynosa 53 por motivos de salud",
    at: "2026-11-10T15:12:00-06:00",
    expected: {
      branchNumbers: [53],
      branchCode: null,
      branchStatus: "desconocida",
      acceptance: "desconocida",
      shift: "matutino",
      dates: ["2026-11-12", "2026-11-13"],
      decision: "NOTIFICAR",
      reason: "varios_dias",
    },
  },
  {
    id: "hoy-51",
    text: "Busco cobertura para hoy turno matutino en Reynosa 51",
    at: "2026-11-13T06:50:00-06:00",
    expected: {
      branchNumbers: [51],
      branchCode: "F-7544",
      branchStatus: "resuelta",
      acceptance: "no_aceptada",
      shift: "matutino",
      dates: ["2026-11-13"],
      decision: "DESCARTAR",
      reason: "sucursal_no_aceptada",
    },
  },
  {
    id: "cumbres-3",
    text: "Buenos días busco cobertura para hoy 9 noviembre matutino en cumbres Reynosa 3",
    at: "2026-11-09T07:40:00-06:00",
    expected: {
      branchNumbers: [3],
      branchCode: "S-0404",
      branchStatus: "resuelta",
      acceptance: "aceptada",
      shift: "matutino",
      dates: ["2026-11-09"],
      decision: "APARTAR",
      reason: "cumple",
    },
  },
];
