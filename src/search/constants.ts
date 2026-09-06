/** Transformers.js, loaded on demand inside the embedding worker. */
export const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
export const WORKER_START_TIMEOUT_MS = 8000;
/**
 * Vector cache database, one per model (the library prunes a cache to the current index's
 * keys, so sharing one across models would evict the other model's vectors on every switch).
 * The default model keeps the bare name; see `vectorDbName`. The library's own default DB
 * would be shared with its demo on the same origin.
 */
export const VECTOR_DB_NAME = "schema-explorer-vectors";
export const WORKER_BATCH_SIZE = 16;
export const MAIN_THREAD_BATCH_SIZE = 8;
/** Upper bound on the WebGPU probe at boot (it normally answers within milliseconds). */
export const WEBGPU_PROBE_TIMEOUT_MS = 3000;

/** Shortest query that triggers a semantic lookup ("BMI", "HRT", "ID" are real variable names). */
export const MIN_QUERY_LENGTH = 2;
export const SEMANTIC_DEBOUNCE_MS = 250;

/** Semantic-only ("related") rows kept per query: roughly 15 per dataset so no dataset starves. */
export function maxRelatedFor(datasetCount: number): number {
  return Math.min(200, Math.max(20, 15 * datasetCount));
}

/** Rows shown per dataset group before "Show all". */
export const PER_DATASET_EXACT = 8;
export const PER_DATASET_RELATED = 5;
