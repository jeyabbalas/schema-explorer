import { describe, expect, it } from "vitest";
import type { AppActions } from "../src/app/actions";
import { MAX_DATASETS } from "../src/ingest/build";
import { ingest } from "../src/ingest/index";
import { buildCatalog } from "../src/search/catalog";
import { createCatalogSearch } from "../src/search/catalogSearch";
import { resultsToCsvRows, RESULT_CSV_COLUMNS } from "../src/search/exportCsv";
import { colorAllocator } from "../src/state/selectors";
import type { Dataset } from "../src/state/types";
import { renderResultRow } from "../src/ui/resultRow";
import { rowView } from "../src/ui/rowView";
import { readAllExampleGroups } from "./helpers/examples";

/** A table with a variable note, a value note, a skip pattern that pins a code and one that allows a set. */
const MENOPAUSE = {
  title: "Menopause",
  type: "array",
  items: {
    type: "object",
    required: ["meno_status", "meno_age"],
    properties: {
      meno_status: {
        title: "Menopausal status",
        enum: [1, 2],
        enumDescriptions: ["Postmenopausal", "Premenopausal"]
      },
      meno_age: {
        title: "Age at menopause (years)",
        $comment: "Source coding: 777 premenopausal; 888 missing.",
        anyOf: [
          { type: "number", minimum: 20, maximum: 65, not: { enum: [777, 888] } },
          { const: 777, title: "Premenopausal at questionnaire", $comment: "Set by the skip pattern." },
          { const: 888, title: "Missing/Unknown" }
        ]
      },
      hrt_menopause: {
        title: "HRT use after menopause",
        enum: [0, 1, 999],
        enumDescriptions: ["No", "Yes", "Missing"]
      }
    },
    allOf: [
      {
        if: { properties: { meno_status: { const: 2 } } },
        then: { properties: { meno_age: { const: 777 } } },
        $comment: "Premenopausal women skip the age question."
      },
      {
        if: { required: ["meno_status"], properties: { meno_status: { const: 1 } } },
        then: { properties: { hrt_menopause: { enum: [0, 1] } } },
        $comment: "Postmenopausal women answer the HRT question."
      }
    ]
  }
};

async function loadDataset(schema: unknown): Promise<Dataset> {
  const text = JSON.stringify(schema);
  const result = await ingest(
    {
      kind: "texts",
      label: "Menopause",
      source: "upload",
      files: [{ path: "menopause.schema.json", text, bytes: text.length }]
    },
    { existingDatasets: [], existingBatches: [], maxDatasets: MAX_DATASETS, nextColor: colorAllocator([]) }
  );
  const dataset = result.outcomes.flatMap((outcome) => outcome.datasets)[0];
  if (!dataset) throw new Error("no dataset");
  return dataset;
}

const actions = { openInDictionary: () => undefined } as unknown as AppActions;

describe("result rows", () => {
  it("has a view of every row of every example table", async () => {
    for (const { group, files } of readAllExampleGroups()) {
      const result = await ingest(
        { kind: "texts", label: group.label, source: "example", files },
        {
          existingDatasets: [],
          existingBatches: [],
          maxDatasets: MAX_DATASETS,
          nextColor: colorAllocator([])
        }
      );
      for (const dataset of result.outcomes.flatMap((outcome) => outcome.datasets)) {
        dataset.table.rows.forEach((row, index) => {
          expect(rowView(dataset.table, index)?.name).toBe(row["Variable name"]);
        });
      }
    }
  });

  it("shows notes, labels and each skip pattern once, on the value it sets", async () => {
    const dataset = await loadDataset(MENOPAUSE);
    const search = createCatalogSearch(buildCatalog([dataset], 1));
    const render = (name: string, query = "menopause"): HTMLTableRowElement => {
      const result = search.search(query);
      const hit = result.ranked.find((candidate) => candidate.row["Variable name"] === name);
      if (!hit) throw new Error(`no hit for ${name}`);
      return renderResultRow(hit, dataset, result.terms, actions);
    };

    const age = render("meno_age");
    const description = age.querySelector(".se-row__desc");
    expect(description?.textContent).toBe(
      "Age at menopause (years)Note Source coding: 777 premenopausal; 888 missing."
    );
    expect(description?.querySelector("mark")?.textContent?.toLowerCase()).toContain("menopaus");
    expect(description?.querySelector(".se-note")?.textContent).toBe(
      "Note Source coding: 777 premenopausal; 888 missing."
    );
    const code = Array.from(age.querySelectorAll(".se-vals__sentinel")).find((li) =>
      li.textContent?.startsWith("777")
    );
    expect(code?.querySelector(".se-vals__when")?.textContent).toBe("if meno_status = 2 (Premenopausal)");
    expect(Array.from(code?.querySelectorAll(".se-why") ?? []).map((node) => node.textContent)).toEqual([
      "Set by the skip pattern.",
      "Premenopausal women skip the age question."
    ]);
    // The pattern is on the code, not repeated (or doubled) among the constraints.
    const constraints = age.querySelector(".se-row__cons")?.textContent ?? "";
    expect(constraints).toContain("Measured value: 20 ≤ value ≤ 65");
    expect(constraints).not.toContain("meno_status");

    // A pattern that allows a set of values stays a constraint, with its comment.
    const hrt = render("hrt_menopause");
    const rule = hrt.querySelector(".se-cons__cond");
    expect(rule?.firstChild?.textContent).toBe(
      "When meno_status = 1 (Postmenopausal), value is one of 0 (No), 1 (Yes) or absent."
    );
    expect(rule?.querySelector(".se-why")?.textContent).toBe("Postmenopausal women answer the HRT question.");

    // Codes labelled by enumDescriptions read with their labels.
    expect(render("meno_status", "meno_status").querySelector(".se-vals")?.textContent).toContain(
      "2 Premenopausal"
    );
  });

  it("exports one value or constraint per line, with the special codes and notes", async () => {
    const dataset = await loadDataset(MENOPAUSE);
    const result = createCatalogSearch(buildCatalog([dataset], 1)).search("meno_age");
    const rows = resultsToCsvRows(result, [dataset]);
    const column = (name: (typeof RESULT_CSV_COLUMNS)[number]): string =>
      rows[1]?.[RESULT_CSV_COLUMNS.indexOf(name)] ?? "";
    expect(column("Variable")).toBe("meno_age");
    expect(column("Description")).toBe(
      "Age at menopause (years)\nSource coding: 777 premenopausal; 888 missing."
    );
    expect(column("Valid values").split("\n")).toEqual([
      "20–65 (measured value)",
      "Special codes:",
      "777 = Premenopausal at questionnaire [when meno_status = 2 (Premenopausal)] — Note: Set by the skip pattern.",
      "888 = Missing/Unknown"
    ]);
    expect(column("Constraints").split("\n")[0]).toBe("Required");
  });
});
