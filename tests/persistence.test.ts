import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/app/actions";
import {
  createDatasetsStore,
  DB_NAME,
  DB_VERSION,
  MAX_PERSIST_BATCH_BYTES,
  savedColumnWidths,
  STORES,
  toStoredBatch,
  type StoredBatch
} from "../src/persist/datasetsStore";
import { openKv } from "../src/persist/kv";
import { DEFAULT_MODEL_ID } from "../src/search/models";
import { createStore } from "../src/state/store";
import { initialState, type LoadBatch } from "../src/state/types";
import { until } from "./helpers/dom";
import { installExamplesFetch } from "./helpers/examples";

function freshKv() {
  return openKv(DB_NAME, DB_VERSION, STORES, { factory: new IDBFactory(), timeoutMs: 2000 });
}

const storedBatch = (id: string, label = id, bytes?: number): StoredBatch => ({
  id,
  label,
  source: "upload",
  createdAt: Number(id.replace(/\D/g, "")) || 1,
  hash: `hash-${id}`,
  bytes: bytes ?? 10,
  docs: [{ path: "root.json", text: '{"type":"array"}' }]
});

describe("kv", () => {
  it("round-trips values through IndexedDB", async () => {
    const kv = await freshKv();
    expect(kv.available).toBe(true);
    await kv.set("batches", "a", { id: "a" });
    await kv.set("batches", "b", { id: "b" });
    expect(await kv.get("batches", "a")).toEqual({ id: "a" });
    expect((await kv.getAll<{ id: string }>("batches")).map((v) => v.id).sort()).toEqual(["a", "b"]);
    await kv.del("batches", "a");
    expect(await kv.get("batches", "a")).toBeUndefined();
    await kv.clear("batches");
    expect(await kv.getAll("batches")).toEqual([]);
    kv.close();
  });

  it("degrades to an in-memory stub when IndexedDB does not open", async () => {
    const silent = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const factory = { open: () => ({}) as IDBOpenDBRequest } as unknown as IDBFactory;
    const kv = await openKv("stuck", 1, ["x"], { factory, timeoutMs: 30 });
    expect(kv.available).toBe(false);
    await kv.set("x", "k", 1);
    expect(await kv.get("x", "k")).toBeUndefined();
    silent.mockRestore();
  });
});

describe("datasets store", () => {
  it("saves, replaces, lists, deletes and clears batches and meta", async () => {
    const store = createDatasetsStore(freshKv());
    expect(await store.ready()).toBe(true);
    expect(await store.saveBatch(storedBatch("b2"))).toBe("saved");
    expect(await store.saveBatch(storedBatch("b1"))).toBe("saved");
    expect(await store.saveBatch({ ...storedBatch("b1"), label: "renamed" })).toBe("saved");
    let loaded = await store.loadAll();
    expect(loaded.batches.map((b) => [b.id, b.label])).toEqual([
      ["b1", "renamed"],
      ["b2", "b2"]
    ]);
    expect(loaded.meta).toBeUndefined();

    await store.saveMeta({ v: 1, appVersion: "t", datasetOrder: ["x"], hiddenDatasets: [], overrides: {} });
    loaded = await store.loadAll();
    expect(loaded.meta?.datasetOrder).toEqual(["x"]);

    await store.deleteBatch("b2");
    expect((await store.loadAll()).batches.map((b) => b.id)).toEqual(["b1"]);
    await store.clearAll();
    loaded = await store.loadAll();
    expect(loaded.batches).toEqual([]);
    expect(loaded.meta).toBeUndefined();
  });

  it("refuses oversized batches and reports an unavailable store", async () => {
    const store = createDatasetsStore(freshKv());
    expect(await store.saveBatch(storedBatch("huge", "huge", MAX_PERSIST_BATCH_BYTES + 1))).toBe(
      "skipped-quota"
    );
    const silent = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unavailable = createDatasetsStore(
      openKv("x", 1, ["y"], {
        factory: { open: () => ({}) as IDBOpenDBRequest } as unknown as IDBFactory,
        timeoutMs: 20
      })
    );
    expect(await unavailable.ready()).toBe(false);
    expect(await unavailable.saveBatch(storedBatch("a"))).toBe("unavailable");
    expect(await unavailable.loadAll()).toEqual({ batches: [], meta: undefined });
    silent.mockRestore();
  });

  it("keeps only known columns with a positive width from saved column widths", () => {
    expect(
      savedColumnWidths({ Description: 419.6, Bogus: 200, Constraints: -1, Format: "wide", Notes: NaN })
    ).toEqual({ Description: 420 });
    expect(savedColumnWidths({ Bogus: 200 })).toBeUndefined();
    expect(savedColumnWidths("wide")).toBeUndefined();
  });

  it("converts a batch to its stored form (text only)", () => {
    const batch: LoadBatch = {
      id: "b",
      label: "B",
      source: "example",
      createdAt: 5,
      hash: "h",
      roots: [],
      docs: [{ path: "a.json", name: "a.json", uri: "u", text: "{}", schema: {}, bytes: 2 }]
    };
    expect(toStoredBatch(batch)).toEqual({
      id: "b",
      label: "B",
      source: "example",
      createdAt: 5,
      hash: "h",
      bytes: 2,
      docs: [{ path: "a.json", text: "{}" }]
    });
  });
});

describe("restore on boot", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rebuilds datasets from the saved documents with the saved arrangement", async () => {
    installExamplesFetch();
    const kv = freshKv();
    const datasetsStore = createDatasetsStore(kv);

    // Session 1: load the examples, remove one table of a two-table batch, rename and collapse another.
    const first = createStore(
      initialState({ theme: "light", semantic: false, semanticModel: DEFAULT_MODEL_ID })
    );
    const firstActions = createActions(first, {
      datasetsStore,
      yield: () => Promise.resolve(),
      appVersion: "test"
    });
    await firstActions.boot();
    await firstActions.loadExamples();
    expect(first.get().datasets).toHaveLength(5);
    await until(async () => (await datasetsStore.loadAll()).batches.length === 4, 5_000, "batches saved");
    const participant = first.get().datasets.find((d) => d.label === "OFH · participant");
    const bgs = first.get().datasets.find((d) => d.label === "BGS");
    if (!participant || !bgs) throw new Error("missing datasets");
    await firstActions.removeDataset(participant.id);
    firstActions.renameDataset(bgs.id, "Generations");
    firstActions.setColumnWidths(bgs.id, { Description: 420, "Valid values": 300 });
    firstActions.setCardCollapsed(bgs.id, true);
    await until(
      async () => (await datasetsStore.loadAll()).meta?.overrides[bgs.id]?.label === "Generations",
      5_000,
      "meta saved"
    );
    const savedMeta = (await datasetsStore.loadAll()).meta;
    expect(savedMeta?.hiddenDatasets).toEqual([participant.id]);
    expect(savedMeta?.datasetOrder).toHaveLength(4);
    expect(savedMeta?.overrides[bgs.id]?.columnWidths).toEqual({ Description: 420, "Valid values": 300 });

    // Session 2: a fresh store restores the same arrangement.
    const second = createStore(
      initialState({ theme: "light", semantic: false, semanticModel: DEFAULT_MODEL_ID })
    );
    const secondActions = createActions(second, {
      datasetsStore,
      yield: () => Promise.resolve(),
      appVersion: "test"
    });
    await secondActions.boot();
    const restored = second.get();
    expect(restored.phase).toBe("ready");
    expect(restored.persistence.available).toBe(true);
    expect(restored.datasets.map((d) => d.label)).toEqual([
      "Generations",
      "MWS",
      "OFH · questionnaire",
      "TARGET"
    ]);
    expect(restored.datasets.map((d) => d.id)).toEqual(first.get().datasets.map((d) => d.id));
    expect(restored.datasets.map((d) => d.colorIndex)).toEqual(first.get().datasets.map((d) => d.colorIndex));
    expect(restored.ui.cards[bgs.id]).toEqual({
      collapsed: true,
      columnWidths: { Description: 420, "Valid values": 300 }
    });
    expect(Object.keys(restored.batches)).toHaveLength(4);
    expect(restored.datasets[0]?.variableCount).toBe(60);
    expect(restored.search.result).toBeUndefined();

    // Search works immediately on the restored catalog.
    secondActions.setQuery("smoking");
    expect(second.get().search.result?.datasetsWithHits).toBeGreaterThanOrEqual(3);

    // Clearing wipes storage too.
    await secondActions.clearAll();
    expect((await datasetsStore.loadAll()).batches).toEqual([]);
    const third = createStore(
      initialState({ theme: "light", semantic: false, semanticModel: DEFAULT_MODEL_ID })
    );
    await createActions(third, { datasetsStore, yield: () => Promise.resolve() }).boot();
    expect(third.get().datasets).toEqual([]);
  });

  it("boots without a store and reports an unavailable one", async () => {
    installExamplesFetch();
    const silent = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const plain = createStore(
      initialState({ theme: "light", semantic: false, semanticModel: DEFAULT_MODEL_ID })
    );
    await createActions(plain, { yield: () => Promise.resolve() }).boot();
    expect(plain.get().phase).toBe("ready");
    const unavailable = createDatasetsStore(
      openKv("x", 1, ["y"], {
        factory: { open: () => ({}) as IDBOpenDBRequest } as unknown as IDBFactory,
        timeoutMs: 20
      })
    );
    const store = createStore(
      initialState({ theme: "light", semantic: false, semanticModel: DEFAULT_MODEL_ID })
    );
    await createActions(store, { datasetsStore: unavailable, yield: () => Promise.resolve() }).boot();
    expect(store.get().persistence.available).toBe(false);
    expect(store.get().notices[0]?.text).toContain("will not be kept");
    silent.mockRestore();
  });
});
