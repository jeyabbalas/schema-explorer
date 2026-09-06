// Orchestration: every state mutation goes through here. Dataset-changing operations are
// serialised through one queue so a drop during an example load cannot interleave with it.

import { MAX_DATASETS } from "../ingest/build";
import { collectFromDataTransfer, collectFromFileList, type Collected } from "../ingest/collect";
import { fetchExampleGroup, fetchExampleManifest } from "../ingest/examples";
import { ingest, type IngestResult, type IngestSource } from "../ingest/index";
import { uniqueLabel } from "../ingest/paths";
import { savePrefs } from "../persist/prefs";
import { appendNotices, createNotice } from "../state/notices";
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
  registerShelf(bridge: ShelfBridge): void;
  /** Observe dataset set changes (search rebuilds, persistence). */
  onDatasetsChanged(listener: (reason: DatasetsChangeReason) => void): () => void;
}

export interface ActionDeps {
  /** Injected in tests to avoid real timers between roots. */
  yield?: (() => Promise<void>) | undefined;
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

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task, task);
    queue = run.catch((err: unknown) => {
      console.error("[schema-explorer] action failed", err);
    });
    return run;
  };

  const datasetsChanged = (reason: DatasetsChangeReason): void => {
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
    async boot() {
      store.set({ phase: "ready" });
      await Promise.resolve();
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
    },

    setCardCollapsed(id, collapsed) {
      store.set((state) => ({ ui: { ...state.ui, cards: { ...state.ui.cards, [id]: { collapsed } } } }));
    },

    setAllCardsCollapsed(collapsed) {
      store.set((state) => {
        const cards = { ...state.ui.cards };
        for (const dataset of state.datasets) cards[dataset.id] = { collapsed };
        return { ui: { ...state.ui, cards } };
      });
    },

    clearAll() {
      return enqueue(async () => {
        removed.clear();
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
