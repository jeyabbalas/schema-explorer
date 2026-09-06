// Orchestration: every state mutation goes through here. Dataset-changing operations are
// serialised through one queue so a drop during an example load cannot interleave with it.

import { MAX_DATASETS } from "../ingest/build";
import { collectFromDataTransfer, collectFromFileList, type Collected } from "../ingest/collect";
import { fetchExampleGroup, fetchExampleManifest } from "../ingest/examples";
import { ingest, type IngestResult, type IngestSource } from "../ingest/index";
import { uniqueLabel } from "../ingest/paths";
import { parseTexts } from "../ingest/parse";
import { buildDatasets } from "../ingest/build";
import { toStoredBatch, type DatasetsStore, type StoredMeta } from "../persist/datasetsStore";
import { savePrefs } from "../persist/prefs";
import { buildCatalog, type Catalog } from "../search/catalog";
import { createCatalogSearch, type CatalogSearch } from "../search/catalogSearch";
import { exportResultsCsv, suggestedCsvFilename } from "../search/exportCsv";
import type { SemanticController } from "../search/semantic";
import type { CatalogSearchResult } from "../search/types";
import { appendNotices, createNotice } from "../state/notices";
import { downloadText } from "../util/download";
import { colorAllocator } from "../state/selectors";
import type { Store } from "../state/store";
import type { AppState, Dataset, LoadBatch, Notice, NoticeLevel, ThemePreference } from "../state/types";
import { yieldToBrowser } from "../util/async";
import { errorMessage, pluralize } from "../util/text";

/** What the card shelf can do for the actions layer (registered once the UI is mounted). */
export interface ShelfBridge {
  focusDataset(id: string): boolean;
  showVariable(id: string, name: string): boolean;
}

export type DatasetsChangeReason = "add" | "remove" | "undo" | "clear" | "restore";

export interface AppActions {
  boot(): Promise<void>;
  addFiles(files: FileList | readonly File[], kind?: "files" | "folder"): Promise<void>;
  addDrop(dt: DataTransfer): Promise<void>;
  loadExamples(): Promise<void>;
  removeDataset(id: string): Promise<void>;
  undoRemove(id: string): void;
  renameDataset(id: string, label: string): void;
  setCardCollapsed(id: string, collapsed: boolean): void;
  setAllCardsCollapsed(collapsed: boolean): void;
  clearAll(): Promise<void>;
  setTheme(theme: ThemePreference): void;
  notify(
    level: NoticeLevel,
    text: string,
    extra?: { details?: string[] | undefined; datasetId?: string | undefined }
  ): void;
  dismissNotice(id: string): void;
  runNoticeAction(noticeId: string): void;
  focusDataset(id: string): void;
  /** Scroll to a dataset's card and show one variable in its own dictionary. */
  openInDictionary(datasetId: string, name: string): void;
  registerShelf(bridge: ShelfBridge): void;
  setQuery(query: string): void;
  /** Turn semantic search on or off (remembered). */
  setSemantic(on: boolean): Promise<void>;
  retrySemantic(): Promise<void>;
  /** Download the current results as CSV; returns the CSV text (undefined when there is nothing to export). */
  exportResultsCsv(): string | undefined;
  announce(text: string): void;
  /** Observe dataset set changes (search rebuilds, persistence). */
  onDatasetsChanged(listener: (reason: DatasetsChangeReason) => void): () => void;
}

export interface ActionDeps {
  /** Injected in tests to avoid real timers between roots. */
  yield?: (() => Promise<void>) | undefined;
  /** The semantic-search controller; attaches one index to each rebuilt catalog. */
  semantic?: SemanticController | undefined;
  /** Persistence of loaded schemas and the dataset arrangement across reloads. */
  datasetsStore?: DatasetsStore | undefined;
  appVersion?: string | undefined;
}

interface RemovedEntry {
  dataset: Dataset;
  batch: LoadBatch | undefined;
  index: number;
}

export function createActions(store: Store<AppState>, deps: ActionDeps = {}): AppActions {
  let queue: Promise<void> = Promise.resolve();
  let shelf: ShelfBridge | undefined;
  const removed = new Map<string, RemovedEntry>();
  const noticeActions = new Map<string, () => void>();
  const changeListeners = new Set<(reason: DatasetsChangeReason) => void>();
  const yieldFn = deps.yield ?? yieldToBrowser;
  let catalog: Catalog | undefined;
  let catalogSearch: CatalogSearch | undefined;
  let unsubscribeSearch: (() => void) | undefined;
  /** Datasets removed while their batch still has other datasets (kept out on restore). */
  const hidden = new Set<string>();
  let metaTimer: ReturnType<typeof setTimeout> | undefined;

  const currentMeta = (): StoredMeta => {
    const state = store.get();
    const overrides: StoredMeta["overrides"] = {};
    for (const dataset of state.datasets) {
      overrides[dataset.id] = {
        label: dataset.label,
        colorIndex: dataset.colorIndex,
        collapsed: state.ui.cards[dataset.id]?.collapsed ?? false
      };
    }
    return {
      v: 1,
      appVersion: deps.appVersion ?? "dev",
      datasetOrder: state.datasets.map((dataset) => dataset.id),
      hiddenDatasets: [...hidden],
      overrides
    };
  };

  /** Save the arrangement (order, labels, colours, collapsed cards); bursts are coalesced. */
  const persistMeta = (): void => {
    if (!deps.datasetsStore) return;
    if (metaTimer) clearTimeout(metaTimer);
    metaTimer = setTimeout(() => {
      metaTimer = undefined;
      void deps.datasetsStore?.saveMeta(currentMeta());
    }, 300);
  };

  const persistBatches = async (batches: readonly LoadBatch[]): Promise<void> => {
    const datasetsStore = deps.datasetsStore;
    if (!datasetsStore || batches.length === 0) return;
    for (const batch of batches) {
      const result = await datasetsStore.saveBatch(toStoredBatch(batch));
      if (result === "skipped-quota") {
        pushNotices([
          createNotice(
            "warning",
            `${batch.label} is too large to keep after a reload; it stays loaded for this session.`
          )
        ]);
      } else if (result === "failed") {
        pushNotices([
          createNotice(
            "warning",
            `${batch.label} could not be saved in this browser; it stays loaded for this session.`
          )
        ]);
      }
    }
    persistMeta();
  };

  /** Rebuild datasets from the saved documents (same path as ingestion). */
  const restore = async (): Promise<void> => {
    const datasetsStore = deps.datasetsStore;
    if (!datasetsStore) return;
    const available = await datasetsStore.ready();
    store.set({ persistence: { available, lastError: undefined } });
    if (!available) {
      pushNotices([createNotice("info", "Datasets will not be kept after a reload in this browser.")]);
      return;
    }
    const { batches, meta } = await datasetsStore.loadAll();
    if (batches.length === 0) return;
    setBusy({ kind: "restoring", label: "Restoring saved datasets…" });
    for (const id of meta?.hiddenDatasets ?? []) hidden.add(id);
    const restoredBatches: LoadBatch[] = [];
    const restored: Dataset[] = [];
    const notices: Notice[] = [];
    for (const stored of batches) {
      try {
        const { docs, errors } = parseTexts(stored.docs);
        if (errors.length > 0)
          notices.push(
            createNotice("warning", `Some saved files of ${stored.label} could not be read.`, {
              details: errors.map((e) => e.path)
            })
          );
        const outcome = await buildDatasets(
          {
            batchId: stored.id,
            label: stored.label,
            source: stored.source,
            docs,
            createdAt: stored.createdAt
          },
          {
            existing: restored,
            maxDatasets: MAX_DATASETS,
            nextColor: colorAllocator(restored),
            yield: yieldFn
          }
        );
        const kept = outcome.datasets.filter((dataset) => !hidden.has(dataset.id));
        if (outcome.batch && kept.length > 0) {
          restoredBatches.push(outcome.batch);
          restored.push(...kept);
        } else {
          await datasetsStore.deleteBatch(stored.id);
        }
      } catch (err) {
        notices.push(createNotice("error", `Could not restore ${stored.label}: ${errorMessage(err)}`));
      }
    }
    // Apply the saved arrangement: order, labels, colours (unique), collapsed cards.
    const order = new Map((meta?.datasetOrder ?? []).map((id, index) => [id, index]));
    restored.sort(
      (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
    const overrides = meta?.overrides ?? {};
    const taken = new Set<number>();
    const cards: AppState["ui"]["cards"] = {};
    const labels = new Set<string>();
    const finalDatasets = restored.map((dataset) => {
      const override = overrides[dataset.id];
      let colorIndex = override?.colorIndex;
      if (colorIndex === undefined || taken.has(colorIndex)) {
        colorIndex = 0;
        while (taken.has(colorIndex)) colorIndex += 1;
      }
      taken.add(colorIndex);
      const label = uniqueLabel(override?.label?.trim() || dataset.label, labels);
      labels.add(label);
      if (override?.collapsed) cards[dataset.id] = { collapsed: true };
      return { ...dataset, label, colorIndex };
    });
    store.batch(() => {
      store.set((state) => {
        const nextBatches = { ...state.batches };
        for (const batch of restoredBatches) nextBatches[batch.id] = batch;
        return {
          batches: nextBatches,
          datasets: [...state.datasets, ...finalDatasets],
          catalogVersion: state.catalogVersion + 1,
          notices: appendNotices(state.notices, notices),
          ui: { ...state.ui, cards: { ...state.ui.cards, ...cards } }
        };
      });
    });
    if (finalDatasets.length > 0) datasetsChanged("restore");
  };

  /** Accept a result only if it was computed against the current catalog. */
  const applyResult = (result: CatalogSearchResult): void => {
    const state = store.get();
    if (result.catalogVersion !== state.catalogVersion) return;
    if (result.normalizedQuery !== result.query.trim().toLowerCase().replace(/\s+/g, " ")) return;
    store.set({ search: { query: state.search.query, result } });
  };

  deps.semantic?.subscribe((semantic) => {
    store.set({ semantic });
  });

  /** Start the embedder (model download) and, once ready, rebuild the search with its index. */
  const startSemantic = async (userInitiated: boolean): Promise<void> => {
    const semantic = deps.semantic;
    if (!semantic) return;
    const wasOff = store.get().semantic.kind === "off";
    if (userInitiated && wasOff) {
      pushNotices([
        createNotice(
          "info",
          "Downloading the semantic model (23 MB) from Hugging Face. Keyword search keeps working meanwhile."
        )
      ]);
    }
    const ok = await semantic.start();
    if (!store.get().prefs.semantic) return; // switched off while starting
    if (ok) {
      rebuildSearch();
      return;
    }
    const state = store.get().semantic;
    if (userInitiated && state.kind === "error") {
      pushNotices([
        createNotice(
          "error",
          `Couldn’t start semantic search: ${state.message}. Keyword search still works.`,
          {
            details: state.hint ? [state.hint] : undefined
          }
        )
      ]);
    }
  };

  const runQuery = (): void => {
    const state = store.get();
    if (!catalogSearch || state.search.query.trim().length === 0) {
      if (state.search.result !== undefined)
        store.set({ search: { query: state.search.query, result: undefined } });
      return;
    }
    applyResult(catalogSearch.search(state.search.query));
  };

  /** Rebuild the merged catalog and its engine after any change to the set of datasets. */
  const rebuildSearch = (): void => {
    unsubscribeSearch?.();
    unsubscribeSearch = undefined;
    catalogSearch?.dispose();
    catalogSearch = undefined;
    const state = store.get();
    catalog = buildCatalog(state.datasets, state.catalogVersion);
    if (catalog.totalRows > 0) {
      catalogSearch = createCatalogSearch(catalog, { semanticIndex: deps.semantic?.attach(catalog) });
      unsubscribeSearch = catalogSearch.subscribe(applyResult);
    } else {
      deps.semantic?.attach(catalog);
    }
    runQuery();
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task, task);
    queue = run.catch((err: unknown) => {
      console.error("[schema-explorer] action failed", err);
    });
    return run;
  };

  const datasetsChanged = (reason: DatasetsChangeReason): void => {
    rebuildSearch();
    for (const listener of [...changeListeners]) {
      try {
        listener(reason);
      } catch (err) {
        console.error("[schema-explorer] datasets listener failed", err);
      }
    }
  };

  const pushNotices = (notices: readonly Notice[]): void => {
    if (notices.length > 0) store.set((state) => ({ notices: appendNotices(state.notices, notices) }));
  };

  const setBusy = (busy: AppState["busy"]): void => {
    store.set({ busy });
  };

  const ingestContext = (onProgress: (label: string, fraction?: number) => void) => {
    const state = store.get();
    return {
      existingDatasets: state.datasets,
      existingBatches: Object.values(state.batches),
      maxDatasets: MAX_DATASETS,
      nextColor: colorAllocator(state.datasets),
      onProgress,
      yield: yieldFn
    };
  };

  /** Merge an ingestion result into the state and announce what was loaded. */
  const applyIngest = (
    result: IngestResult,
    options: { announce: boolean; ignoredFiles: boolean }
  ): Dataset[] => {
    const added: Dataset[] = [];
    const batches: LoadBatch[] = [];
    const notices: Notice[] = [...result.notices];
    for (const outcome of result.outcomes) {
      if (outcome.batch) batches.push(outcome.batch);
      added.push(...outcome.datasets);
      if (options.announce && outcome.batch && outcome.datasets.length > 0) {
        const suffix =
          options.ignoredFiles && result.ignored.length > 0
            ? ` · ${pluralize(result.ignored.length, "file")} ignored`
            : "";
        if (outcome.datasets.length === 1) {
          const dataset = outcome.datasets[0] as Dataset;
          notices.push(
            createNotice(
              "info",
              `Loaded ${dataset.label} · ${pluralize(dataset.variableCount, "variable")} in ${pluralize(dataset.categoryCount, "category", "categories")}${suffix}`,
              { datasetId: dataset.id }
            )
          );
        } else {
          notices.push(
            createNotice(
              "info",
              `Loaded ${pluralize(outcome.datasets.length, "dataset")} from ${outcome.batch.label} (${outcome.datasets.length} tables): ${outcome.datasets.map((d) => d.label).join(", ")}${suffix}`
            )
          );
        }
      }
    }
    store.batch(() => {
      store.set((state) => {
        const nextBatches = { ...state.batches };
        for (const batch of batches) nextBatches[batch.id] = batch;
        return {
          batches: nextBatches,
          datasets: added.length > 0 ? [...state.datasets, ...added] : state.datasets,
          catalogVersion: added.length > 0 ? state.catalogVersion + 1 : state.catalogVersion,
          notices: appendNotices(state.notices, notices),
          ui: options.ignoredFiles ? { ...state.ui, ignoredFiles: result.ignored } : state.ui
        };
      });
    });
    if (added.length > 0) datasetsChanged("add");
    void persistBatches(batches);
    return added;
  };

  const ingestSource = (
    source: IngestSource,
    options: { announce: boolean; ignoredFiles: boolean }
  ): Promise<Dataset[]> =>
    enqueue(async () => {
      setBusy({ kind: "ingesting", label: "Reading files…" });
      try {
        const result = await ingest(
          source,
          ingestContext((label, fraction) => setBusy({ kind: "ingesting", label, progress: fraction }))
        );
        applyIngest(result, options);
      } catch (err) {
        pushNotices([createNotice("error", `Could not load the selection: ${errorMessage(err)}`)]);
      } finally {
        setBusy(undefined);
      }
    }).then(() => []);

  const actions: AppActions = {
    boot() {
      return enqueue(async () => {
        rebuildSearch();
        try {
          await restore();
        } catch (err) {
          pushNotices([createNotice("error", `Could not restore the saved datasets: ${errorMessage(err)}`)]);
        } finally {
          setBusy(undefined);
          store.set({ phase: "ready" });
        }
        if (store.get().prefs.semantic) void startSemantic(false);
      });
    },

    addFiles(files, _kind) {
      const collected = collectFromFileList(files);
      return ingestSource({ kind: "files", collected }, { announce: true, ignoredFiles: true }).then(
        () => undefined
      );
    },

    addDrop(dt) {
      // webkitGetAsEntry() only works synchronously inside the drop event.
      const entries = collectFromDataTransfer(dt);
      const pending: Promise<{ collected: Collected; label: string | undefined }> = entries
        ? entries.done.then((collected) => ({ collected, label: entries.label }))
        : Promise.resolve({ collected: collectFromFileList(dt.files), label: undefined });
      return enqueue(async () => {
        setBusy({ kind: "ingesting", label: "Reading the dropped items…" });
        try {
          const { collected, label } = await pending;
          const result = await ingest(
            { kind: "files", collected, label },
            ingestContext((text, fraction) => setBusy({ kind: "ingesting", label: text, progress: fraction }))
          );
          applyIngest(result, { announce: true, ignoredFiles: true });
        } catch (err) {
          pushNotices([createNotice("error", `Could not load the dropped items: ${errorMessage(err)}`)]);
        } finally {
          setBusy(undefined);
        }
      });
    },

    loadExamples() {
      return enqueue(async () => {
        setBusy({ kind: "loading-examples", label: "Loading examples…", progress: 0 });
        const loaded: Dataset[] = [];
        let skipped = 0;
        try {
          const manifest = await fetchExampleManifest();
          const total = manifest.groups.reduce((sum, group) => sum + group.files.length, 0);
          let fetched = 0;
          for (const group of manifest.groups) {
            const { files, errors } = await fetchExampleGroup(group, {
              onProgress: () => {
                fetched += 1;
                setBusy({
                  kind: "loading-examples",
                  label: `Loading examples · ${group.label}…`,
                  progress: fetched / total
                });
              }
            });
            if (errors.length > 0) {
              pushNotices([
                createNotice("error", `Could not load the ${group.label} example.`, { details: errors })
              ]);
              continue;
            }
            setBusy({
              kind: "loading-examples",
              label: `Building ${group.label}…`,
              progress: fetched / total
            });
            const result = await ingest(
              { kind: "texts", label: group.label, source: "example", files },
              ingestContext(() => undefined)
            );
            const before = store.get().datasets.length;
            applyIngest(result, { announce: false, ignoredFiles: false });
            const added = store.get().datasets.slice(before);
            loaded.push(...added);
            if (added.length === 0) skipped += 1;
          }
          if (loaded.length > 0) {
            pushNotices([
              createNotice(
                "info",
                `Loaded ${pluralize(loaded.length, "example dataset")}: ${loaded.map((d) => d.label).join(", ")}`
              )
            ]);
          } else if (skipped > 0) {
            pushNotices([createNotice("info", "The example datasets are already loaded.")]);
          }
        } catch (err) {
          pushNotices([createNotice("error", `Could not load the example datasets: ${errorMessage(err)}`)]);
        } finally {
          setBusy(undefined);
        }
      });
    },

    removeDataset(id) {
      return enqueue(async () => {
        const state = store.get();
        const index = state.datasets.findIndex((dataset) => dataset.id === id);
        if (index < 0) return;
        const dataset = state.datasets[index] as Dataset;
        const stillUsed = state.datasets.some(
          (other) => other.id !== id && other.batchId === dataset.batchId
        );
        const batch = stillUsed ? undefined : state.batches[dataset.batchId];
        removed.set(id, { dataset, batch, index });
        if (batch) void deps.datasetsStore?.deleteBatch(batch.id);
        else hidden.add(id);
        const notice = createNotice("info", `Removed ${dataset.label}`, {});
        notice.action = { label: "Undo" };
        noticeActions.set(notice.id, () => actions.undoRemove(id));
        store.batch(() => {
          store.set((current) => {
            const batches = { ...current.batches };
            if (batch) delete batches[dataset.batchId];
            const cards = { ...current.ui.cards };
            delete cards[id];
            return {
              datasets: current.datasets.filter((other) => other.id !== id),
              batches,
              catalogVersion: current.catalogVersion + 1,
              notices: appendNotices(current.notices, [notice]),
              ui: { ...current.ui, cards }
            };
          });
        });
        datasetsChanged("remove");
        persistMeta();
        await Promise.resolve();
      });
    },

    undoRemove(id) {
      const entry = removed.get(id);
      if (!entry) return;
      removed.delete(id);
      store.batch(() => {
        store.set((current) => {
          if (current.datasets.some((dataset) => dataset.id === id)) return {};
          const datasets = [...current.datasets];
          const taken = new Set(datasets.map((dataset) => dataset.label));
          const restored = taken.has(entry.dataset.label)
            ? { ...entry.dataset, label: uniqueLabel(entry.dataset.label, taken) }
            : entry.dataset;
          datasets.splice(Math.min(entry.index, datasets.length), 0, restored);
          const batches = { ...current.batches };
          if (entry.batch) batches[entry.batch.id] = entry.batch;
          return {
            datasets,
            batches,
            catalogVersion: current.catalogVersion + 1,
            notices: current.notices.filter(
              (notice) =>
                !(
                  notice.action &&
                  noticeActions.get(notice.id) &&
                  notice.text === `Removed ${entry.dataset.label}`
                )
            )
          };
        });
      });
      datasetsChanged("undo");
      hidden.delete(id);
      if (entry.batch) void persistBatches([entry.batch]);
      else persistMeta();
    },

    renameDataset(id, label) {
      const trimmed = label.trim();
      if (!trimmed) return;
      store.set((state) => {
        const index = state.datasets.findIndex((dataset) => dataset.id === id);
        if (index < 0) return {};
        const taken = new Set(
          state.datasets.filter((dataset) => dataset.id !== id).map((dataset) => dataset.label)
        );
        const datasets = [...state.datasets];
        datasets[index] = { ...(datasets[index] as Dataset), label: uniqueLabel(trimmed, taken) };
        return { datasets };
      });
      persistMeta();
    },

    setCardCollapsed(id, collapsed) {
      store.set((state) => ({ ui: { ...state.ui, cards: { ...state.ui.cards, [id]: { collapsed } } } }));
      persistMeta();
    },

    setAllCardsCollapsed(collapsed) {
      store.set((state) => {
        const cards = { ...state.ui.cards };
        for (const dataset of state.datasets) cards[dataset.id] = { collapsed };
        return { ui: { ...state.ui, cards } };
      });
      persistMeta();
    },

    clearAll() {
      return enqueue(async () => {
        removed.clear();
        hidden.clear();
        if (metaTimer) clearTimeout(metaTimer);
        metaTimer = undefined;
        await Promise.all([deps.semantic?.clearVectors(), deps.datasetsStore?.clearAll()]);
        store.set((state) => ({
          datasets: [],
          batches: {},
          catalogVersion: state.catalogVersion + 1,
          search: { query: "", result: undefined },
          notices: [],
          ui: { ...state.ui, cards: {}, ignoredFiles: [] }
        }));
        datasetsChanged("clear");
        await Promise.resolve();
      });
    },

    setTheme(theme) {
      savePrefs({ theme });
      store.set((state) => ({ prefs: { ...state.prefs, theme } }));
    },

    notify(level, text, extra) {
      pushNotices([createNotice(level, text, extra)]);
    },

    dismissNotice(id) {
      noticeActions.delete(id);
      store.set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) }));
    },

    runNoticeAction(noticeId) {
      const run = noticeActions.get(noticeId);
      noticeActions.delete(noticeId);
      store.set((state) => ({ notices: state.notices.filter((notice) => notice.id !== noticeId) }));
      run?.();
    },

    focusDataset(id) {
      shelf?.focusDataset(id);
    },

    openInDictionary(datasetId, name) {
      const dataset = store.get().datasets.find((candidate) => candidate.id === datasetId);
      if (!dataset) return;
      if (store.get().ui.cards[datasetId]?.collapsed) actions.setCardCollapsed(datasetId, false);
      const shown = shelf?.showVariable(datasetId, name) ?? false;
      actions.announce(shown ? `Opened ${name} in ${dataset.label}.` : `Scrolled to ${dataset.label}.`);
    },

    setQuery(query) {
      const state = store.get();
      if (state.search.query === query) return;
      store.set({ search: { query, result: state.search.result } });
      runQuery();
    },

    async setSemantic(on) {
      if (store.get().prefs.semantic === on && (on ? store.get().semantic.kind !== "off" : true)) {
        if (!on) return;
      }
      savePrefs({ semantic: on });
      store.set((state) => ({ prefs: { ...state.prefs, semantic: on } }));
      if (on) {
        await startSemantic(true);
      } else {
        deps.semantic?.stop();
        rebuildSearch();
      }
    },

    async retrySemantic() {
      if (!store.get().prefs.semantic) return;
      deps.semantic?.stop();
      await startSemantic(true);
    },

    exportResultsCsv() {
      const state = store.get();
      const result = state.search.result;
      if (!result || result.totalExact + result.totalRelated === 0) return undefined;
      const csv = exportResultsCsv(result, state.datasets);
      downloadText(suggestedCsvFilename(state.search.query), csv, "text/csv;charset=utf-8");
      actions.notify("info", "Results CSV downloaded.");
      return csv;
    },

    announce(text) {
      store.set((state) => ({ ui: { ...state.ui, announcement: text } }));
    },

    registerShelf(bridge) {
      shelf = bridge;
    },

    onDatasetsChanged(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    }
  };
  return actions;
}
