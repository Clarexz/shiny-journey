/**
 * Sucursales que acepta el doctor (plan, 0, 7.5 y 16.1.1). Es la base del config por
 * defecto del tenant y de las pruebas.
 */
import type { AcceptedBranch } from "../src/server/branch";

export const DOCTOR_ACCEPTED: AcceptedBranch[] = [
  { number: 1, code: "S-0202", label: "Heron Ramirez", aliases: [] },
  { number: 2, code: "S-0219", label: "Centro", aliases: [] },
  { number: 3, code: "S-0404", label: "Cumbres", aliases: [] },
  { number: 4, code: "S-0414", label: "Blvd Hidalgo", aliases: ["hidalgo", "blv hidalgo"] },
  { number: 10, code: "S-0805", label: "Centro", aliases: [] },
  // A-02: sin código; si el mensaje no dice "olmo", es ambigua y el DM pregunta.
  { number: 11, code: null, label: "Olmo", aliases: [] },
  { number: 15, code: "S-1430", label: "Vista Hermosa", aliases: [] },
  { number: 17, code: "S-1607", label: "Puerta del Sol", aliases: [] },
  { number: 21, code: "S-1858", label: "Aquiles", aliases: [] },
  // A-03: se asume F-0651.
  { number: 22, code: "F-0651", label: "Jarachina Sur", aliases: [] },
  { number: 30, code: "F-4224", label: "Caracoles", aliases: [] },
  { number: 30, code: "S-2266", label: "Hacienda del Sol", aliases: [] },
  { number: 31, code: "F-4706", label: "Petrolera", aliases: [] },
  { number: 40, code: "F-6477", label: "Jarachina Sur", aliases: [] },
  { number: 50, code: "F-7456", label: "Vista Alta", aliases: [] },
];
