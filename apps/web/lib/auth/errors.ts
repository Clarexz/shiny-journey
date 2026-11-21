import { NextResponse } from "next/server";

/** Error con código HTTP para route handlers (respuestas `{ error }`, como en ravyn-crm). */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 500,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("route handler: error no controlado", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}
