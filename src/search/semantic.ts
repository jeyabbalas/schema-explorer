// Semantic search lifecycle: start the embedder (worker first, main thread as a fallback),
// download the model, keep exactly ONE semantic index over the current merged catalog, and
// report progress as a small state machine the UI renders.

import {
  createIndexedDbVectorCache,
  createMemoryVectorCache,
  createSemanticIndex,
  createWorkerEmbedder,
  type Embedder,
  type SemanticIndex,
  type SemanticStatus,
  type VectorCache
} from "json-schema-data-dictionary";
import type { SemanticState } from "../state/types";
import { withTimeout } from "../util/async";
import { errorMessage } from "../util/text";
import type { Catalog } from "./catalog";
import {
  MAIN_THREAD_BATCH_SIZE,
  VECTOR_DB_NAME,
  WORKER_BATCH_SIZE,
  WORKER_START_TIMEOUT_MS
} from "./constants";
import { createLocalEmbedder } from "./embedderFactory";

export interface WorkerConfig {
  device?: string | undefined;
  dtype?: string | undefined;
  nogpu?: boolean | undefined;
}

/** Dev/test overrides from the page URL: ?device=wasm&dtype=q8&nogpu=1 */
export function workerConfigFromLocation(search: string): WorkerConfig {
  const params = new URLSearchParams(search);
  const config: WorkerConfig = {};
  const device = params.get("device");
  const dtype = params.get("dtype");
  if (device) config.device = device;
  if (dtype) config.dtype = dtype;
  if (params.get("nogpu") === "1") config.nogpu = true;
  return config;
}

/** The literal `new Worker(new URL(...))` form is what lets the bundler emit the worker chunk. */
export function createEmbedWorker(config: WorkerConfig = {}): Worker {
  return new Worker(new URL("./embed.worker.ts", import.meta.url), {
    type: "module",
    name: JSON.stringify(config)
  });
}

export interface SemanticControllerOptions {
  createWorker?: (() => Worker) | undefined;
  workerConfig?: WorkerConfig | undefined;
  /** Bypass the worker entirely (tests): supply the embedder directly. */
  createEmbedder?: (() => Promise<Embedder>) | undefined;
  /** Vector cache; default IndexedDB (dedicated DB), `false` for memory only. */
  cache?: VectorCache | false | undefined;
  /** Optional precomputed `.jsddvec` vectors for the loaded texts. */
  snapshotUrl?: string | undefined;
  startTimeoutMs?: number | undefined;
  now?: (() => number) | undefined;
}

export interface SemanticController {
  readonly state: SemanticState;
  readonly embedder: Embedder | undefined;
  readonly index: SemanticIndex | undefined;
  /** Load the embedder; resolves true when it is ready and this start was not superseded. Idempotent. */
  start(): Promise<boolean>;
  stop(): void;
  /** Replace the index with one over `catalog`; undefined when the embedder is not loaded or the catalog is empty. */
  attach(catalog: Catalog): SemanticIndex | undefined;
  subscribe(listener: (state: SemanticState) => void): () => void;
  clearVectors(): Promise<void>;
  dispose(): void;
}

const DEVICE_HINT = /webgpu|adapter|shader/i;
const NETWORK_HINT = /failed to fetch|networkerror|load failed|err_|fetch|network|404|403|cors/i;

export function hintFor(message: string): string | undefined {
  if (NETWORK_HINT.test(message)) {
    return "The model (~23 MB) is downloaded from huggingface.co and Transformers.js from cdn.jsdelivr.net; check your connection or content blockers, then retry.";
  }
  if (DEVICE_HINT.test(message)) return "WebGPU failed; retrying should fall back to WASM.";
  if (/did not respond|worker/i.test(message))
    return "The embedding worker did not start; retrying uses the main thread.";
  return undefined;
}

export function createSemanticController(options: SemanticControllerOptions = {}): SemanticController {
  const listeners = new Set<(state: SemanticState) => void>();
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const cache: VectorCache =
    options.cache === false
      ? createMemoryVectorCache()
      : (options.cache ??
        (typeof indexedDB !== "undefined"
          ? createIndexedDbVectorCache({ dbName: VECTOR_DB_NAME })
          : createMemoryVectorCache()));

  let state: SemanticState = { kind: "off" };
  let generation = 0;
  let starting: Promise<boolean> | undefined;
  let embedder: Embedder | undefined;
  let worker: Worker | undefined;
  let mainThread = false;
  let index: SemanticIndex | undefined;
  let unsubscribeIndex: (() => void) | undefined;
  let eta: { t0: number; done0: number } | undefined;

  const setState = (next: SemanticState): void => {
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch (err) {
        console.error("[schema-explorer] semantic listener failed", err);
      }
    }
  };

  const errorState = (err: unknown): SemanticState => {
    const message = errorMessage(err);
    return { kind: "error", message, hint: hintFor(message), retryable: true };
  };

  const mapStatus = (status: SemanticStatus): SemanticState => {
    switch (status.state) {
      case "loading":
        return { kind: "loading", progress: status.progress };
      case "indexing": {
        const t = now();
        if (!eta) eta = { t0: t, done0: status.done };
        const elapsed = t - eta.t0;
        const embedded = status.done - eta.done0;
        const etaMs =
          elapsed >= 2000 && embedded >= 32 && status.done < status.total
            ? ((status.total - status.done) * elapsed) / embedded
            : undefined;
        return { kind: "indexing", done: status.done, total: status.total, coverage: status.coverage, etaMs };
      }
      case "ready":
        return { kind: "ready", device: embedder?.info?.device, dtype: embedder?.info?.dtype, mainThread };
      case "error":
        return errorState(new Error(status.message));
    }
  };

  const dropIndex = (): void => {
    unsubscribeIndex?.();
    unsubscribeIndex = undefined;
    index?.dispose();
    index = undefined;
    eta = undefined;
  };

  const discard = (candidateWorker: Worker | undefined, candidate: Embedder | undefined): void => {
    if (candidateWorker) candidateWorker.terminate();
    else if (candidate) void Promise.resolve(candidate.dispose?.()).catch(() => undefined);
  };

  const acquireEmbedder = async (
    gen: number
  ): Promise<{ embedder: Embedder; worker: Worker | undefined; mainThread: boolean }> => {
    if (options.createEmbedder)
      return { embedder: await options.createEmbedder(), worker: undefined, mainThread: false };
    let candidate: Worker | undefined;
    try {
      candidate = (options.createWorker ?? (() => createEmbedWorker(options.workerConfig)))();
      const proxy = await withTimeout(
        createWorkerEmbedder(candidate),
        options.startTimeoutMs ?? WORKER_START_TIMEOUT_MS,
        "the embedding worker did not respond"
      );
      return { embedder: proxy, worker: candidate, mainThread: false };
    } catch (err) {
      candidate?.terminate();
      if (gen !== generation) throw err;
      console.info(
        `[schema-explorer] embedding worker unavailable (${errorMessage(err)}); using the main thread`
      );
      return {
        embedder: createLocalEmbedder({ batchSize: MAIN_THREAD_BATCH_SIZE }),
        worker: undefined,
        mainThread: true
      };
    }
  };

  const controller: SemanticController = {
    get state() {
      return state;
    },
    get embedder() {
      return embedder;
    },
    get index() {
      return index;
    },

    start() {
      if (embedder) return Promise.resolve(true);
      if (starting) return starting;
      const gen = ++generation;
      setState({ kind: "starting" });
      starting = (async () => {
        let acquired: { embedder: Embedder; worker: Worker | undefined; mainThread: boolean } | undefined;
        try {
          acquired = await acquireEmbedder(gen);
          if (gen !== generation) {
            discard(acquired.worker, acquired.embedder);
            return false;
          }
          setState({ kind: "loading", progress: undefined });
          await acquired.embedder.load?.((fraction) => {
            if (gen === generation) setState({ kind: "loading", progress: fraction });
          });
          if (gen !== generation) {
            discard(acquired.worker, acquired.embedder);
            return false;
          }
          embedder = acquired.embedder;
          worker = acquired.worker;
          mainThread = acquired.mainThread;
          setState({ kind: "loading", progress: 1 });
          return true;
        } catch (err) {
          if (acquired) discard(acquired.worker, acquired.embedder);
          if (gen === generation) setState(errorState(err));
          return false;
        } finally {
          if (gen === generation) starting = undefined;
        }
      })();
      return starting;
    },

    stop() {
      generation += 1;
      starting = undefined;
      dropIndex();
      discard(worker, embedder);
      worker = undefined;
      embedder = undefined;
      mainThread = false;
      setState({ kind: "off" });
    },

    attach(catalog) {
      dropIndex();
      if (!embedder) return undefined;
      if (catalog.totalRows === 0) {
        setState({ kind: "ready", device: embedder.info?.device, dtype: embedder.info?.dtype, mainThread });
        return undefined;
      }
      const created = createSemanticIndex(catalog.merged, {
        embedder,
        cache,
        batchSize: mainThread ? MAIN_THREAD_BATCH_SIZE : WORKER_BATCH_SIZE,
        ...(options.snapshotUrl ? { snapshot: options.snapshotUrl } : {})
      });
      // `ready` rejects on dispose; the status stream already carries errors.
      created.ready.catch(() => undefined);
      index = created;
      unsubscribeIndex = created.subscribe((status) => {
        if (index === created) setState(mapStatus(status));
      });
      setState(mapStatus(created.status));
      return created;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async clearVectors() {
      try {
        await cache.clear();
      } catch (err) {
        console.warn("[schema-explorer] could not clear the vector cache", err);
      }
    },

    dispose() {
      controller.stop();
      listeners.clear();
    }
  };
  return controller;
}
