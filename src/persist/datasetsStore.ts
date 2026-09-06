// Persists loaded schema documents (as text) and the user's arrangement of datasets, so a reload
// restores everything. Text rather than parsed tables: independent of the library's output
// model (an upgrade simply rebuilds on the next boot), smaller to clone, and stable to hash.

import type { BatchSource, LoadBatch } from "../state/types";
import { errorMessage } from "../util/text";
import type { Kv } from "./kv";

export const DB_NAME = "schema-explorer";
export const DB_VERSION = 1;
export const STORE_BATCHES = "batches";
export const STORE_META = "meta";
export const STORES = [STORE_BATCHES, STORE_META] as const;
export const META_KEY = "current";

/** Batches larger than this stay in memory only. */
export const MAX_PERSIST_BATCH_BYTES = 50 * 1024 * 1024;
const QUOTA_HEADROOM = 0.9;

export interface StoredBatch {
  id: string;
  label: string;
  source: BatchSource;
  createdAt: number;
  hash: string;
  bytes: number;
  docs: Array<{ path: string; text: string }>;
}

export interface DatasetOverride {
  label?: string | undefined;
  colorIndex?: number | undefined;
  collapsed?: boolean | undefined;
}

export interface StoredMeta {
  v: 1;
  appVersion: string;
  /** Dataset ids in display order. */
  datasetOrder: string[];
  /** Datasets the user removed while their batch still has other datasets. */
  hiddenDatasets: string[];
  overrides: Record<string, DatasetOverride>;
}

export type SaveResult = "saved" | "skipped-quota" | "failed" | "unavailable";

export interface DatasetsStore {
  ready(): Promise<boolean>;
  loadAll(): Promise<{ batches: StoredBatch[]; meta: StoredMeta | undefined }>;
  saveBatch(batch: StoredBatch): Promise<SaveResult>;
  deleteBatch(id: string): Promise<void>;
  saveMeta(meta: StoredMeta): Promise<void>;
  clearAll(): Promise<void>;
  estimate(): Promise<{ usage: number; quota: number } | undefined>;
}

export function toStoredBatch(batch: LoadBatch): StoredBatch {
  const docs = batch.docs.map((doc) => ({ path: doc.path, text: doc.text }));
  return {
    id: batch.id,
    label: batch.label,
    source: batch.source,
    createdAt: batch.createdAt,
    hash: batch.hash,
    bytes: docs.reduce((sum, doc) => sum + doc.text.length, 0),
    docs
  };
}

function isStoredBatch(value: unknown): value is StoredBatch {
  if (typeof value !== "object" || value === null) return false;
  const batch = value as Partial<StoredBatch>;
  return (
    typeof batch.id === "string" &&
    typeof batch.label === "string" &&
    (batch.source === "upload" || batch.source === "example") &&
    typeof batch.createdAt === "number" &&
    Array.isArray(batch.docs) &&
    batch.docs.every((doc) => typeof doc?.path === "string" && typeof doc?.text === "string")
  );
}

function isStoredMeta(value: unknown): value is StoredMeta {
  if (typeof value !== "object" || value === null) return false;
  const meta = value as Partial<StoredMeta>;
  return (
    meta.v === 1 &&
    Array.isArray(meta.datasetOrder) &&
    Array.isArray(meta.hiddenDatasets) &&
    typeof meta.overrides === "object"
  );
}

export function createDatasetsStore(kvPromise: Promise<Kv> | Kv): DatasetsStore {
  const kv = Promise.resolve(kvPromise);
  const estimate = async (): Promise<{ usage: number; quota: number } | undefined> => {
    try {
      if (typeof navigator === "undefined" || !navigator.storage?.estimate) return undefined;
      const result = await navigator.storage.estimate();
      if (typeof result.usage !== "number" || typeof result.quota !== "number") return undefined;
      return { usage: result.usage, quota: result.quota };
    } catch {
      return undefined;
    }
  };

  return {
    ready: () => kv.then((instance) => instance.available),

    async loadAll() {
      const instance = await kv;
      if (!instance.available) return { batches: [], meta: undefined };
      try {
        const [rawBatches, rawMeta] = await Promise.all([
          instance.getAll<unknown>(STORE_BATCHES),
          instance.get<unknown>(STORE_META, META_KEY)
        ]);
        const batches = rawBatches.filter(isStoredBatch).sort((a, b) => a.createdAt - b.createdAt);
        return { batches, meta: isStoredMeta(rawMeta) ? rawMeta : undefined };
      } catch (err) {
        console.warn("[schema-explorer] could not read saved datasets", err);
        return { batches: [], meta: undefined };
      }
    },

    async saveBatch(batch) {
      const instance = await kv;
      if (!instance.available) return "unavailable";
      if (batch.bytes > MAX_PERSIST_BATCH_BYTES) return "skipped-quota";
      const usage = await estimate();
      if (usage && usage.quota > 0 && usage.usage + batch.bytes > usage.quota * QUOTA_HEADROOM)
        return "skipped-quota";
      try {
        await instance.set(STORE_BATCHES, batch.id, batch);
        return "saved";
      } catch (err) {
        console.warn(`[schema-explorer] could not save ${batch.label}: ${errorMessage(err)}`);
        return "failed";
      }
    },

    async deleteBatch(id) {
      const instance = await kv;
      if (!instance.available) return;
      try {
        await instance.del(STORE_BATCHES, id);
      } catch (err) {
        console.warn("[schema-explorer] could not delete a saved batch", err);
      }
    },

    async saveMeta(meta) {
      const instance = await kv;
      if (!instance.available) return;
      try {
        await instance.set(STORE_META, META_KEY, meta);
      } catch (err) {
        console.warn("[schema-explorer] could not save the dataset arrangement", err);
      }
    },

    async clearAll() {
      const instance = await kv;
      if (!instance.available) return;
      try {
        await Promise.all([instance.clear(STORE_BATCHES), instance.clear(STORE_META)]);
      } catch (err) {
        console.warn("[schema-explorer] could not clear saved datasets", err);
      }
    },

    estimate
  };
}
