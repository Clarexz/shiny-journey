import { z, type ZodType } from "zod";

/**
 * Convierte un esquema Zod al subconjunto de JSON Schema que acepta el modo estricto de
 * Structured Outputs: todo objeto con `additionalProperties: false` y todas sus propiedades en
 * `required` (los opcionales se expresan como `nullable`). Se quitan las palabras clave que el
 * modo estricto no garantiza (`pattern`, `minimum`, etc.): la respuesta se valida después con
 * el mismo esquema Zod, que sí las revisa.
 */
const KEEP = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "anyOf",
  "const",
  "description",
  "$defs",
  "$ref",
]);

type Json = Record<string, unknown>;

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== "object") return node;
  const src = node as Json;
  const out: Json = {};
  for (const [k, v] of Object.entries(src)) {
    if (!KEEP.has(k)) continue;
    if (k === "properties" || k === "$defs") {
      out[k] = Object.fromEntries(Object.entries(v as Json).map(([pk, pv]) => [pk, clean(pv)]));
    } else {
      out[k] = clean(v);
    }
  }
  if (out.type === "object" || out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys((out.properties as Json | undefined) ?? {});
  }
  return out;
}

export function toStrictJsonSchema(schema: ZodType): Json {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" });
  return clean(raw) as Json;
}
