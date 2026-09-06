// Result types of the cross-dataset search (the engine lives in catalogSearch.ts). Kept in a
// separate, dependency-free module so the app state can reference them without importing the
// search implementation.

import type { DataDictionaryRow, LexicalMatch, SearchResult } from "json-schema-data-dictionary";

/** One matching variable, positioned in both the merged catalog and its own dataset. */
export interface Hit {
  datasetId: string;
  /** Index into the dataset's `table.rows`. */
  localRow: number;
  /** Index into the merged catalog rows. */
  mergedRow: number;
  row: DataDictionaryRow;
  categoryTitle: string;
  /** Fused rank score; only comparable within one query. */
  score: number;
  /** True for keyword matches; false for semantic-only ("related") rows. */
  exact: boolean;
  /** The whole query equals the variable name. */
  exactName: boolean;
  keywordScore: number;
  lexicalScore: number;
  /** Mean-centred cosine similarity when the semantic index scored the row. */
  semanticScore: number | undefined;
  /** Where the query matched (empty for related rows). */
  matches: LexicalMatch[];
}

export interface DatasetHits {
  datasetId: string;
  exact: Hit[];
  related: Hit[];
  /** Best fused score in the group (undefined when the group is empty). */
  best: number | undefined;
}

export interface CatalogSearchResult {
  /** The catalog version the result was computed against; stale results are discarded. */
  catalogVersion: number;
  query: string;
  normalizedQuery: string;
  /** Surface terms to highlight, longest first; empty means highlight the raw query. */
  terms: string[];
  semantic: SearchResult["semantic"];
  totalExact: number;
  totalRelated: number;
  /** One entry per dataset, in dataset order; hits inside keep global rank order. */
  perDataset: DatasetHits[];
  datasetsWithHits: number;
  /** Every hit, best first. */
  ranked: Hit[];
}
