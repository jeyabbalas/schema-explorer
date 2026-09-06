import { describe, expect, it } from "vitest";
import { findSchemaRoots, schemaDocumentsToTable } from "json-schema-data-dictionary";

// Sanity check that the data-dictionary library is wired in and resolves relative $refs the
// way the app relies on: a root table schema plus one category file with a synthetic base URI.
describe("json-schema-data-dictionary wiring", () => {
  const docs = [
    {
      uri: "https://schema-explorer.local/t/root.schema.json",
      name: "root.schema.json",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "Tiny table",
        type: "array",
        items: { type: "object", allOf: [{ $ref: "categories/demo.json" }] }
      }
    },
    {
      uri: "https://schema-explorer.local/t/categories/demo.json",
      name: "demo.json",
      schema: {
        title: "Demo",
        type: "object",
        properties: {
          age: { title: "Age in years", type: "integer", minimum: 0 },
          smoker: {
            title: "Smoking status",
            oneOf: [
              { const: 0, title: "Never" },
              { const: 1, title: "Ever" }
            ]
          }
        }
      }
    }
  ];

  it("detects the table root and flattens the category into rows", () => {
    const roots = findSchemaRoots(docs).filter((c) => c.arrayLike && !c.referenced);
    expect(roots.map((r) => r.name)).toEqual(["root.schema.json"]);
    const table = schemaDocumentsToTable(docs, { rootUri: roots[0]?.uri, splitAllOfObjectCategories: true });
    expect(table.rows.map((r) => r["Variable name"])).toEqual(["age", "smoker"]);
    expect(table.categories.map((c) => c.title)).toEqual(["Demo"]);
    expect(table.warnings).toEqual([]);
  });
});
