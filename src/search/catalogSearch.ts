// Cross-dataset search: one library search engine over the merged catalog, with results
// regrouped per dataset.

import {
  createSearchEngine,
  type SearchEngine,
  type SearchResult,
  type SemanticIndex
} from "json-schema-data-dictionary";
import type { Catalog } from "./catalog";
import { MIN_QUERY_LENGTH, SEMANTIC_DEBOUNCE_MS, maxRelatedFor } from "./constants";
import type { CatalogSearchResult, DatasetHits, Hit } from "./types";

export interface CatalogSearchOptions {
  semanticIndex?: SemanticIndex | undefined;
  maxRelated?: number | undefined;
  minQueryLength?: number | undefined;
  debounceMs?: number | undefined;
}

export interface CatalogSearch {
  readonly catalog: Catalog;
  /** Synchronous: keyword matches fused with the last known semantic hits for the query. */
  search(query: string): CatalogSearchResult;
  /** Asynchronous semantic updates for the current query. */
  subscribe(listener: (result: CatalogSearchResult) => void): () => void;
  readonly current: CatalogSearchResult | undefined;
  /** Disposes the engine only; the semantic index is owned by its controller. */
  dispose(): void;
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function emptyResult(catalog: Catalog, query = ""): CatalogSearchResult {
  return {
    catalogVersion: catalog.version,
    query,
    normalizedQuery: normalizeQuery(query),
    terms: [],
    semantic: { state: "off", coverage: 0 },
    totalExact: 0,
    totalRelated: 0,
    perDataset: catalog.datasets.map((dataset) => ({
      datasetId: dataset.id,
      exact: [],
      related: [],
      best: undefined
    })),
    datasetsWithHits: 0,
    ranked: []
  };
}

/** Regroup a library result per dataset (pure). */
export function toCatalogResult(catalog: Catalog, result: SearchResult): CatalogSearchResult {
  const groups = new Map<string, DatasetHits>();
  const perDataset: DatasetHits[] = catalog.datasets.map((dataset) => {
    const group: DatasetHits = { datasetId: dataset.id, exact: [], related: [], best: undefined };
    groups.set(dataset.id, group);
    return group;
  });
  const ranked: Hit[] = [];
  for (const entry of result.results) {
    const owner = catalog.owners[entry.row];
    const row = catalog.merged.rows[entry.row];
    if (!owner || !row) continue;
    const hit: Hit = {
      datasetId: owner.datasetId,
      localRow: owner.localRow,
      mergedRow: entry.row,
      row,
      categoryTitle: catalog.lexicalDocs[entry.row]?.category ?? row.__category ?? "",
      score: entry.score,
      exact: entry.exact,
      exactName: entry.exactName,
      keywordScore: entry.keywordScore,
      lexicalScore: entry.lexicalScore,
      semanticScore: entry.semanticScore,
      matches: entry.matches
    };
    ranked.push(hit);
    const group = groups.get(owner.datasetId);
    if (!group) continue;
    (hit.exact ? group.exact : group.related).push(hit);
    group.best = group.best === undefined ? hit.score : Math.max(group.best, hit.score);
  }
  return {
    catalogVersion: catalog.version,
    query: result.query,
    normalizedQuery: result.normalizedQuery,
    terms: result.terms,
    semantic: result.semantic,
    totalExact: result.exactCount,
    totalRelated: result.relatedCount,
    perDataset,
    datasetsWithHits: perDataset.filter((group) => group.exact.length + group.related.length > 0).length,
    ranked
  };
}

export function createCatalogSearch(catalog: Catalog, options: CatalogSearchOptions = {}): CatalogSearch {
  const listeners = new Set<(result: CatalogSearchResult) => void>();
  let current: CatalogSearchResult | undefined;
  let engine: SearchEngine | undefined;
  let unsubscribe: (() => void) | undefined;

  if (catalog.totalRows > 0) {
    engine = createSearchEngine(catalog.lexicalDocs, {
      semantic: options.semanticIndex,
      maxRelated: options.maxRelated ?? maxRelatedFor(catalog.datasets.length),
      minQueryLength: options.minQueryLength ?? MIN_QUERY_LENGTH,
      debounceMs: options.debounceMs ?? SEMANTIC_DEBOUNCE_MS
    });
    unsubscribe = engine.subscribe((result) => {
      if (!current || result.normalizedQuery !== current.normalizedQuery) return;
      current = toCatalogResult(catalog, result);
      for (const listener of [...listeners]) listener(current);
    });
  }

  return {
    catalog,
    get current() {
      return current;
    },
    search(query) {
      if (!engine || normalizeQuery(query).length === 0) {
        current = emptyResult(catalog, query);
        return current;
      }
      current = toCatalogResult(catalog, engine.search(query));
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      unsubscribe?.();
      engine?.dispose();
      engine = undefined;
      listeners.clear();
    }
  };
}
