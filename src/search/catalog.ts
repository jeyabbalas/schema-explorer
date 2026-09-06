// The merged catalog: every loaded dataset's rows concatenated into one synthetic table, with a
// parallel owner map so a hit in the merged index points back to its dataset and row.

import {
  lexicalDocumentsFromTable,
  type DataDictionaryTable,
  type LexicalDocument
} from "json-schema-data-dictionary";
import type { Dataset } from "../state/types";

export interface RowOwner {
  datasetId: string;
  datasetIndex: number;
  /** Index into the dataset's own `table.rows`. */
  localRow: number;
}

export interface Catalog {
  version: number;
  datasets: readonly Dataset[];
  /** Rows of every dataset in order; categories keep the same row objects (ids prefixed by dataset). */
  merged: DataDictionaryTable;
  /** Parallel to `merged.rows`. */
  owners: RowOwner[];
  /** First merged row of each dataset. */
  offsets: Uint32Array;
  /** Parallel to `merged.rows`: the BM25F documents (memoised per table). */
  lexicalDocs: LexicalDocument[];
  totalRows: number;
}

const lexicalCache = new WeakMap<DataDictionaryTable, LexicalDocument[]>();

/** Lexical documents of a table, computed once per table object. */
export function lexicalDocsFor(table: DataDictionaryTable): LexicalDocument[] {
  let docs = lexicalCache.get(table);
  if (!docs) {
    docs = lexicalDocumentsFromTable(table);
    lexicalCache.set(table, docs);
  }
  return docs;
}

export function buildCatalog(datasets: readonly Dataset[], version: number): Catalog {
  const owners: RowOwner[] = [];
  const offsets = new Uint32Array(datasets.length);
  const lexicalDocs: LexicalDocument[] = [];
  const rows: DataDictionaryTable["rows"] = [];
  const categories: DataDictionaryTable["categories"] = [];
  datasets.forEach((dataset, datasetIndex) => {
    offsets[datasetIndex] = rows.length;
    dataset.table.rows.forEach((row, localRow) => {
      owners.push({ datasetId: dataset.id, datasetIndex, localRow });
      rows.push(row);
    });
    for (const category of dataset.table.categories) {
      categories.push({ ...category, id: `${dataset.id}:${category.id}` });
    }
    lexicalDocs.push(...lexicalDocsFor(dataset.table));
  });
  const merged: DataDictionaryTable = {
    title: "All datasets",
    rows,
    categories,
    conditionalRules: [],
    additionalInformation: null,
    warnings: []
  };
  return { version, datasets, merged, owners, offsets, lexicalDocs, totalRows: rows.length };
}
