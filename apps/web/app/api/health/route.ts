import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness del contenedor web (healthcheck de Docker). No toca la base de datos. */
export function GET() {
  return NextResponse.json({ ok: true });
}
