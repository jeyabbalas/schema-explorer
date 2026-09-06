import { createMemoryVectorCache } from "json-schema-data-dictionary";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/app/actions";
import { MAX_DATASETS } from "../src/ingest/build";
import { ingest } from "../src/ingest/index";
import { buildCatalog } from "../src/search/catalog";
import { createCatalogSearch } from "../src/search/catalogSearch";
import { createSemanticController, hintFor, workerConfigFromLocation } from "../src/search/semantic";
import type { CatalogSearchResult } from "../src/search/types";
import { colorAllocator } from "../src/state/selectors";
import { createStore } from "../src/state/store";
import { initialState, type Dataset, type SemanticState } from "../src/state/types";
import { until } from "./helpers/dom";
import { installExamplesFetch, readExampleGroup } from "./helpers/examples";
import { createFakeEmbedder } from "./helpers/fakeEmbedder";

async function loadDatasets(ids: string[]): Promise<Dataset[]> {
  const datasets: Dataset[] = [];
  for (const id of ids) {
    const { group, files } = readExampleGroup(id);
    const result = await ingest(
      { kind: "texts", label: group.label, source: "example", files },
      {
        existingDatasets: datasets,
        existingBatches: [],
        maxDatasets: MAX_DATASETS,
        nextColor: colorAllocator(datasets)
      }
    );
    datasets.push(...result.outcomes.flatMap((outcome) => outcome.datasets));
  }
  return datasets;
}

const rowText = (result: CatalogSearchResult): string[] =>
  result.ranked
    .filter((hit) => !hit.exact)
    .map((hit) => `${hit.row["Variable name"]} ${hit.row["Description"]}`.toLowerCase());

describe("semantic controller", () => {
  it("loads the embedder, indexes the catalog and surfaces related rows", async () => {
    const fake = createFakeEmbedder();
    const states: SemanticState["kind"][] = [];
    const controller = createSemanticController({
      createEmbedder: () => Promise.resolve(fake),
      cache: createMemoryVectorCache()
    });
    controller.subscribe((state) => states.push(state.kind));
    expect(controller.state.kind).toBe("off");

    const [first, second] = await Promise.all([controller.start(), controller.start()]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fake.calls.loads).toBe(1);
    expect(states).toEqual(["starting", "loading", "loading", "loading", "loading"]);

    const datasets = await loadDatasets(["bgs", "mws"]);
    const catalog = buildCatalog(datasets, 1);
    const index = controller.attach(catalog);
    expect(index).toBeDefined();
    await index?.ready;
    expect(controller.state.kind).toBe("ready");
    expect(fake.calls.document).toBeGreaterThan(0);

    const search = createCatalogSearch(catalog, { semanticIndex: index });
    const seen: CatalogSearchResult[] = [];
    search.subscribe((result) => seen.push(result));
    const initial = search.search("climacteric");
    expect(initial.totalExact).toBe(0);
    expect(["pending", "partial", "complete"]).toContain(initial.semantic.state);
    await until(() => seen.some((result) => result.semantic.state === "complete"), 10_000, "semantic result");
    const complete = seen.find((result) => result.semantic.state === "complete");
    expect(complete?.totalRelated).toBeGreaterThan(0);
    expect(rowText(complete as CatalogSearchResult).some((text) => text.includes("menopaus"))).toBe(true);
    expect(complete?.ranked.every((hit) => !hit.exact && hit.semanticScore !== undefined)).toBe(true);
    expect(complete?.datasetsWithHits).toBeGreaterThanOrEqual(1);
    search.dispose();

    // Rebuilding the index over the same rows reads every vector back from the cache.
    const before = fake.calls.document;
    const again = controller.attach(buildCatalog(datasets, 2));
    await again?.ready;
    expect(fake.calls.document).toBe(before);

    controller.stop();
    expect(controller.state.kind).toBe("off");
    expect(controller.index).toBeUndefined();
    expect(controller.embedder).toBeUndefined();
  });

  it("reports a failed model load as a retryable error", async () => {
    const controller = createSemanticController({
      createEmbedder: () => Promise.resolve(createFakeEmbedder({ failLoad: "Failed to fetch model" })),
      cache: false
    });
    expect(await controller.start()).toBe(false);
    expect(controller.state).toMatchObject({
      kind: "error",
      retryable: true,
      message: "Failed to fetch model"
    });
    expect((controller.state as { hint?: string }).hint).toContain("huggingface.co");
    expect(hintFor("WebGPU adapter lost")).toContain("WebGPU");
    expect(hintFor("something odd")).toBeUndefined();
    controller.dispose();
  });

  it("ignores a start that was stopped before it finished", async () => {
    const controller = createSemanticController({
      createEmbedder: () => new Promise((resolve) => setTimeout(() => resolve(createFakeEmbedder()), 30)),
      cache: false
    });
    const pending = controller.start();
    controller.stop();
    expect(await pending).toBe(false);
    expect(controller.state.kind).toBe("off");
    expect(controller.attach(buildCatalog([], 1))).toBeUndefined();
    controller.dispose();
  });

  it("parses worker overrides from the page URL", () => {
    expect(workerConfigFromLocation("?device=wasm&dtype=q8&nogpu=1")).toEqual({
      device: "wasm",
      dtype: "q8",
      nogpu: true
    });
    expect(workerConfigFromLocation("")).toEqual({});
  });
});

describe("semantic search through the actions layer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("switches semantic search on, finds related variables and switches it off again", async () => {
    installExamplesFetch();
    const fake = createFakeEmbedder();
    const semantic = createSemanticController({
      createEmbedder: () => Promise.resolve(fake),
      cache: createMemoryVectorCache()
    });
    const store = createStore(initialState({ theme: "light", semantic: false }));
    const actions = createActions(store, { semantic, yield: () => Promise.resolve() });
    await actions.boot();
    await actions.loadExamples();
    expect(store.get().datasets).toHaveLength(5);

    await actions.setSemantic(true);
    expect(store.get().prefs.semantic).toBe(true);
    await until(() => store.get().semantic.kind === "ready", 10_000, "semantic ready");

    actions.setQuery("cigarette");
    await until(() => store.get().search.result?.semantic.state === "complete", 10_000, "complete result");
    const result = store.get().search.result;
    expect(result?.totalExact).toBeGreaterThan(0);
    expect(result?.totalRelated).toBeGreaterThan(0);
    expect(rowText(result as CatalogSearchResult).some((text) => text.includes("smok"))).toBe(true);
    expect(store.get().notices.some((notice) => notice.text.includes("Downloading the semantic model"))).toBe(
      true
    );

    await actions.setSemantic(false);
    expect(store.get().semantic.kind).toBe("off");
    expect(store.get().prefs.semantic).toBe(false);
    expect(store.get().search.result?.semantic.state).toBe("off");
    expect(store.get().search.result?.totalRelated).toBe(0);
    semantic.dispose();
  });
});
