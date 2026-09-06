/**
 * Keywords that mark a JSON document as a schema rather than data that happens to be JSON.
 * Mirrors `SCHEMA_KEYWORDS` in json-schema-data-dictionary (src/extract.ts) so the app filters
 * files the same way the library ranks root candidates.
 */
export const SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "type",
  "properties",
  "patternProperties",
  "items",
  "prefixItems",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "enum",
  "const",
  "required",
  "additionalProperties",
  "unevaluatedProperties",
  "contains",
  "$anchor"
]);

/** A plain object carrying at least one JSON Schema keyword (data arrays and ledgers never qualify). */
export function looksLikeSchemaDocument(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => SCHEMA_KEYWORDS.has(key));
}
