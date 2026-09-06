import type { DataDictionaryTable, JsonSchema, SchemaRootCandidate } from "json-schema-data-dictionary";
import type { CatalogSearchResult } from "../search/types";
import type { IgnoredFile } from "../ingest/filter";

/** One JSON Schema document as loaded from a file, a dropped folder, an example set or storage. */
export interface SchemaDoc {
  /** Relative, "/"-separated path after common-prefix stripping; no leading slash. */
  path: string;
  /** File name (last path segment). */
  name: string;
  /** Synthetic retrieval URI (`SYNTH_BASE + batchId + "/" + path`) that relative `$ref`s resolve against. */
  uri: string;
  /** Original JSON text: what gets persisted and hashed. */
  text: string;
  schema: JsonSchema;
  bytes: number;
}

export type BatchSource = "upload" | "example";

/** The documents of one upload action or one example group. A batch yields one dataset per table root. */
export interface LoadBatch {
  id: string;
  label: string;
  source: BatchSource;
  createdAt: number;
  /** Schema-like documents only, sorted by path. */
  docs: SchemaDoc[];
  /** Content hash of the documents (whole-batch dedupe). */
  hash: string;
  /** The table roots chosen for this batch (recomputed on restore). */
  roots: SchemaRootCandidate[];
}

/** One tabular dataset: a table root schema flattened into a data dictionary. */
export interface Dataset {
  /** Stable across reloads: derived from the batch id and the root URI. */
  id: string;
  batchId: string;
  source: BatchSource;
  rootUri: string;
  /** Path of the root document within the batch. */
  rootPath: string;
  /** Short display label (renamable), e.g. "BGS" or "OFH · questionnaire". */
  label: string;
  /** The root schema's title, when it has one. */
  title: string | undefined;
  colorIndex: number;
  /** Immutable once built. */
  table: DataDictionaryTable;
  variableCount: number;
  categoryCount: number;
  /** Non-fatal extraction issues (unresolved `$ref`s, …). */
  warnings: string[];
  /** Hash of the flattened dictionary (dataset-level dedupe). */
  contentHash: string;
  createdAt: number;
}

export type NoticeLevel = "info" | "warning" | "error";

export interface Notice {
  id: string;
  level: NoticeLevel;
  text: string;
  /** Optional list shown behind a disclosure (ignored files, warnings, …). */
  details?: string[] | undefined;
  datasetId?: string | undefined;
  /** An optional button on the toast (e.g. "Undo"); the handler is registered by the actions layer. */
  action?: { label: string } | undefined;
  createdAt: number;
}

export type SemanticState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "loading"; progress: number | undefined }
  | { kind: "indexing"; done: number; total: number; coverage: number; etaMs: number | undefined }
  | { kind: "ready"; device: string | undefined; dtype: string | undefined; mainThread: boolean }
  | { kind: "error"; message: string; hint: string | undefined; retryable: boolean };

export interface SearchState {
  /** The query as typed. */
  query: string;
  result: CatalogSearchResult | undefined;
}

export type ThemePreference = "light" | "dark" | "auto";

export interface Prefs {
  theme: ThemePreference;
  semantic: boolean;
}

export interface BusyState {
  kind: "restoring" | "ingesting" | "loading-examples";
  label: string;
  /** 0..1 when known. */
  progress?: number | undefined;
}

export interface UiState {
  /** A drag with files is over the page. */
  dragOver: boolean;
  /** Per-dataset card state. */
  cards: Record<string, { collapsed: boolean }>;
  /** Files ignored by the most recent ingestion, for the "N files ignored" disclosure. */
  ignoredFiles: IgnoredFile[];
  /** Text for the polite live region (e.g. after a jump to a variable). */
  announcement: string;
}

export interface AppState {
  phase: "booting" | "ready";
  batches: Record<string, LoadBatch>;
  /** Display order; also the order of search result groups. */
  datasets: Dataset[];
  /** Bumped on every add/remove/reorder/clear; search results carry the version they were computed for. */
  catalogVersion: number;
  search: SearchState;
  semantic: SemanticState;
  prefs: Prefs;
  /** Newest last; capped. */
  notices: Notice[];
  busy: BusyState | undefined;
  persistence: { available: boolean; lastError: string | undefined };
  ui: UiState;
}

export function initialState(prefs: Prefs): AppState {
  return {
    phase: "booting",
    batches: {},
    datasets: [],
    catalogVersion: 0,
    search: { query: "", result: undefined },
    semantic: { kind: "off" },
    prefs,
    notices: [],
    busy: undefined,
    persistence: { available: true, lastError: undefined },
    ui: { dragOver: false, cards: {}, ignoredFiles: [], announcement: "" }
  };
}
