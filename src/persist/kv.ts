// A minimal promise wrapper over IndexedDB (out-of-line keys, one transaction per operation).
// `openKv` never rejects: when IndexedDB is missing, blocked or slow to open, it resolves to a
// stub whose reads return nothing and whose writes do nothing, so the app keeps working in memory.

export interface Kv {
  readonly available: boolean;
  get<T>(store: string, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
  set(store: string, key: IDBValidKey, value: unknown): Promise<void>;
  del(store: string, key: IDBValidKey): Promise<void>;
  clear(store: string): Promise<void>;
  close(): void;
}

export interface OpenKvOptions {
  timeoutMs?: number | undefined;
  /** Alternative IDBFactory (tests). Default: the global `indexedDB`. */
  factory?: IDBFactory | undefined;
}

const DEFAULT_TIMEOUT_MS = 5000;

export function unavailableKv(): Kv {
  return {
    available: false,
    get: () => Promise.resolve(undefined),
    getAll: () => Promise.resolve([]),
    set: () => Promise.resolve(),
    del: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    close: () => undefined
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function openKv(
  name: string,
  version: number,
  stores: readonly string[],
  options: OpenKvOptions = {}
): Promise<Kv> {
  const factory = options.factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
  if (!factory) return unavailableKv();
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("IndexedDB did not open in time")),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      );
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(name, version);
      } catch (err) {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      request.onupgradeneeded = () => {
        const upgrading = request.result;
        for (const store of stores) {
          if (!upgrading.objectStoreNames.contains(store)) upgrading.createObjectStore(store);
        }
      };
      request.onblocked = () => {
        clearTimeout(timer);
        reject(new Error("IndexedDB is blocked by another tab"));
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error ?? new Error("IndexedDB failed to open"));
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
    });
  } catch (err) {
    console.warn("[schema-explorer] IndexedDB unavailable; datasets will not persist", err);
    return unavailableKv();
  }
  db.onversionchange = () => db.close();

  const run = <T>(
    store: string,
    mode: IDBTransactionMode,
    op: (objectStore: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> => {
    const transaction = db.transaction(store, mode);
    return requestToPromise(op(transaction.objectStore(store)));
  };

  return {
    available: true,
    get: <T>(store: string, key: IDBValidKey) =>
      run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
    getAll: <T>(store: string) => run<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
    set: async (store, key, value) => {
      await run(store, "readwrite", (s) => s.put(value, key));
    },
    del: async (store, key) => {
      await run(store, "readwrite", (s) => s.delete(key));
    },
    clear: async (store) => {
      await run(store, "readwrite", (s) => s.clear());
    },
    close: () => db.close()
  };
}
