import { describe, expect, it } from "vitest";
import { MAX_DATASETS } from "../src/ingest/build";
import { ingest } from "../src/ingest/index";
import { buildCatalog } from "../src/search/catalog";
import { createCatalogSearch, emptyResult } from "../src/search/catalogSearch";
import { exportResultsCsv, resultsToCsvRows, suggestedCsvFilename, toCsv } from "../src/search/exportCsv";
import { availabilitySummary } from "../src/search/summary";
import { colorAllocator } from "../src/state/selectors";
import type { Dataset } from "../src/state/types";
import { readAllExampleGroups } from "./helpers/examples";

async function loadAllDatasets(): Promise<Dataset[]> {
  const datasets: Dataset[] = [];
  for (const { group, files } of readAllExampleGroups()) {
    const result = await ingest(
      { kind: "texts", label: group.label, source: "example", files },
      {
        existingDatasets: datasets,
        existingBatches: [],
        maxDatasets: MAX_DATASETS,
        nextColor: colorAllocator(datasets)
      }
    );
    datasets.push(...result.outcomes.flatMap((outcome) => outcome.datasets));
  }
  return datasets;
}

describe("cross-dataset search", () => {
  it("maps hits back to the right datasets and groups them in dataset order", async () => {
    const datasets = await loadAllDatasets();
    expect(datasets.map((d) => d.label)).toEqual([
      "BGS",
      "MWS",
      "OFH · participant",
      "OFH · questionnaire",
      "TARGET"
    ]);
    const catalog = buildCatalog(datasets, 7);
    expect(catalog.totalRows).toBe(60 + 38 + 14 + 359 + 5);
    expect(Array.from(catalog.offsets)).toEqual([0, 60, 98, 112, 471]);
    expect(catalog.lexicalDocs).toHaveLength(catalog.totalRows);

    const search = createCatalogSearch(catalog);
    const result = search.search("smoking");
    expect(result.catalogVersion).toBe(7);
    expect(result.datasetsWithHits).toBeGreaterThanOrEqual(3);
    expect(result.totalExact).toBeGreaterThan(0);
    expect(result.totalRelated).toBe(0);
    expect(result.semantic.state).toBe("off");
    expect(result.perDataset.map((group) => group.datasetId)).toEqual(datasets.map((d) => d.id));

    const byLabel = new Map(datasets.map((d) => [d.label, d.id]));
    const hitFor = (name: string) => result.ranked.find((hit) => hit.row["Variable name"] === name);
    expect(hitFor("RSMOKE")?.datasetId).toBe(byLabel.get("MWS"));
    expect(hitFor("R0_SmokingStatus")?.datasetId).toBe(byLabel.get("BGS"));
    expect(hitFor("SmokingStatus")?.datasetId).toBe(byLabel.get("TARGET"));
    for (const hit of result.ranked) {
      const dataset = datasets.find((d) => d.id === hit.datasetId);
      expect(dataset?.table.rows[hit.localRow]).toBe(hit.row);
      expect(catalog.merged.rows[hit.mergedRow]).toBe(hit.row);
    }
    expect(result.terms.length).toBeGreaterThan(0);

    const summary = availabilitySummary(result, datasets);
    expect(summary.map((cell) => cell.label)).toEqual(datasets.map((d) => d.label));
    expect(summary.find((cell) => cell.label === "MWS")?.status).toBe("exact");
    expect(summary.find((cell) => cell.label === "OFH · participant")?.status).toBe("none");
    expect(summary.filter((cell) => cell.status === "exact").every((cell) => cell.top !== undefined)).toBe(
      true
    );
    search.dispose();
  });

  it("ranks an exact variable name first and returns nothing for an empty query", async () => {
    const datasets = await loadAllDatasets();
    const catalog = buildCatalog(datasets, 1);
    const search = createCatalogSearch(catalog);
    const exact = search.search("R0_AlcoholStatus");
    expect(exact.ranked[0]?.row["Variable name"]).toBe("R0_AlcoholStatus");
    expect(exact.ranked[0]?.exactName).toBe(true);
    expect(exact.ranked[0]?.datasetId).toBe(datasets[0]?.id);

    const empty = search.search("   ");
    expect(empty.ranked).toEqual([]);
    expect(empty.perDataset).toHaveLength(datasets.length);
    expect(search.current).toBe(empty);
    expect(emptyResult(catalog, "x").normalizedQuery).toBe("x");
    search.dispose();
  });

  it("exports the results as CSV with the dataset in the first column", async () => {
    const datasets = await loadAllDatasets();
    const search = createCatalogSearch(buildCatalog(datasets, 1));
    const result = search.search("menarche");
    const rows = resultsToCsvRows(result, datasets);
    expect(rows[0]?.[0]).toBe("Dataset");
    expect(rows).toHaveLength(result.ranked.length + 1);
    expect(rows[1]?.[8]).toBe("exact");
    const csv = exportResultsCsv(result, datasets);
    expect(
      csv.startsWith(
        "Dataset,Variable,Description,Data type,Format,Valid values,Constraints,Category,Match,Score,Similarity\r\n"
      )
    ).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(result.ranked.length + 1);
    expect(toCsv([["a,b", 'say "hi"', "plain"]])).toBe('"a,b","say ""hi""",plain\r\n');
    expect(suggestedCsvFilename("age at menarche")).toBe("variables-age-at-menarche.csv");
    search.dispose();
  });

  it("handles an empty catalog", () => {
    const search = createCatalogSearch(buildCatalog([], 3));
    expect(search.search("anything").ranked).toEqual([]);
    search.dispose();
  });
});
