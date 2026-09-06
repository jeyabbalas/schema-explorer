import { constraintsText, validValuesText } from "json-schema-data-dictionary";
import type { Dataset } from "../state/types";
import { slugify } from "../util/text";
import type { CatalogSearchResult } from "./types";

export const RESULT_CSV_COLUMNS = [
  "Dataset",
  "Variable",
  "Description",
  "Data type",
  "Format",
  "Valid values",
  "Constraints",
  "Category",
  "Match",
  "Score",
  "Similarity"
] as const;

/** Header plus one row per hit, in dataset order (exact matches before related ones). */
export function resultsToCsvRows(result: CatalogSearchResult, datasets: readonly Dataset[]): string[][] {
  const labels = new Map(datasets.map((dataset) => [dataset.id, dataset.label]));
  const rows: string[][] = [[...RESULT_CSV_COLUMNS]];
  for (const group of result.perDataset) {
    for (const hit of [...group.exact, ...group.related]) {
      rows.push([
        labels.get(hit.datasetId) ?? hit.datasetId,
        hit.row["Variable name"],
        hit.row["Description"],
        hit.row["Data type"],
        hit.row["Format"],
        validValuesText(hit.row["Valid values"]),
        constraintsText(hit.row["Constraints"]),
        hit.categoryTitle,
        hit.exact ? "exact" : "related",
        hit.score.toFixed(4),
        hit.semanticScore === undefined ? "" : hit.semanticScore.toFixed(3)
      ]);
    }
  }
  return rows;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180: CRLF line ends, quoted cells where needed. */
export function toCsv(rows: ReadonlyArray<readonly string[]>): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function exportResultsCsv(result: CatalogSearchResult, datasets: readonly Dataset[]): string {
  return toCsv(resultsToCsvRows(result, datasets));
}

export function suggestedCsvFilename(query: string): string {
  return `variables-${slugify(query)}.csv`;
}
