import { createMemoryVectorCache, KNOWN_EMBEDDING_MODELS } from "json-schema-data-dictionary";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/app/actions";
import { MAX_DATASETS } from "../src/ingest/build";
import { ingest } from "../src/ingest/index";
import { loadPrefs, savePrefs, SEMANTIC_MODEL_KEY } from "../src/persist/prefs";
import { buildCatalog } from "../src/search/catalog";
import { createCatalogSearch } from "../src/search/catalogSearch";
import { defaultDeviceFor } from "../src/search/embedderFactory";
import { DEFAULT_MODEL_ID, EMBEDDING_MODELS, findModel, isModelId, modelName } from "../src/search/models";
import {
  createSemanticController,
  hintFor,
  vectorDbName,
  workerConfigFromLocation
} from "../src/search/semantic";
import { modelMeta } from "../src/ui/semanticSwitch";
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
    const store = createStore(
      initialState({ theme: "light", semantic: false, semanticModel: DEFAULT_MODEL_ID })
    );
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
    expect(store.get().notices.some((notice) => notice.text.includes("Loading LEAF-IR"))).toBe(true);

    await actions.setSemantic(false);
    expect(store.get().semantic.kind).toBe("off");
    expect(store.get().prefs.semantic).toBe(false);
    expect(store.get().search.result?.semantic.state).toBe("off");
    expect(store.get().search.result?.totalRelated).toBe(0);
    semantic.dispose();
  });
});

const JINA = "jinaai/jina-embeddings-v5-text-nano-retrieval";
const GEMMA = "onnx-community/embeddinggemma-2-ONNX";

describe("embedding model catalogue", () => {
  it("offers verified models only: LEAF-IR first, then the WebGPU-only EmbeddingGemma 2 and Jina v5 nano", () => {
    expect(EMBEDDING_MODELS.map((model) => model.id)).toEqual([DEFAULT_MODEL_ID, GEMMA, JINA]);
    for (const model of EMBEDDING_MODELS) expect(KNOWN_EMBEDDING_MODELS[model.id]).toBeDefined();
    expect(findModel(DEFAULT_MODEL_ID)).toMatchObject({
      name: "LEAF-IR",
      params: "23M",
      license: "Apache-2.0",
      needsWebGpu: false,
      nonCommercial: false
    });
    expect(findModel(GEMMA)).toMatchObject({
      name: "EmbeddingGemma 2",
      params: "270M",
      license: "Apache-2.0",
      needsWebGpu: true,
      nonCommercial: false
    });
    expect(modelMeta(GEMMA, true)).toBe("270M params · Apache-2.0 · 190 MB · WebGPU only");
    expect(defaultDeviceFor(GEMMA)).toBe("webgpu");
    expect(vectorDbName(GEMMA)).toBe("schema-explorer-vectors:onnx-community-embeddinggemma-2-onnx");
    expect(findModel(JINA)).toMatchObject({
      name: "Jina v5 nano",
      params: "239M",
      license: "CC-BY-NC-4.0",
      needsWebGpu: true,
      nonCommercial: true
    });
    expect(isModelId(JINA)).toBe(true);
    expect(isModelId("Xenova/bge-small-en-v1.5")).toBe(false);
    expect(modelName("nobody/unknown")).toBe("nobody/unknown");
    expect(modelMeta(JINA, false)).toContain("WebGPU unavailable");
    expect(modelMeta(JINA, true)).toContain("non-commercial use only");
    // A WebGPU-only model asks for WebGPU explicitly (no silent WASM crawl); the default stays "auto".
    expect(defaultDeviceFor(JINA)).toBe("webgpu");
    expect(defaultDeviceFor(DEFAULT_MODEL_ID)).toBe("auto");
    // Each model caches its vectors in its own database.
    expect(vectorDbName(DEFAULT_MODEL_ID)).toBe("schema-explorer-vectors");
    expect(vectorDbName(JINA)).toBe("schema-explorer-vectors:jinaai-jina-embeddings-v5-text-nano-retrieval");
  });

  it("remembers the model preference and ignores ids the picker does not offer", () => {
    localStorage.clear();
    expect(loadPrefs().semanticModel).toBe(DEFAULT_MODEL_ID);
    savePrefs({ semanticModel: JINA });
    expect(localStorage.getItem(SEMANTIC_MODEL_KEY)).toBe(JINA);
    expect(loadPrefs().semanticModel).toBe(JINA);
    savePrefs({ semanticModel: DEFAULT_MODEL_ID });
    expect(localStorage.getItem(SEMANTIC_MODEL_KEY)).toBeNull();
    localStorage.setItem(SEMANTIC_MODEL_KEY, "Xenova/all-MiniLM-L6-v2");
    expect(loadPrefs().semanticModel).toBe(DEFAULT_MODEL_ID);
    localStorage.clear();
  });
});

describe("switching the embedding model", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("restarts the controller on the new model and re-embeds with it", async () => {
    const embedders = new Map<string, ReturnType<typeof createFakeEmbedder>>();
    const controller = createSemanticController({
      createEmbedder: (model) => {
        const fake = createFakeEmbedder({ id: `fake:${model}`, model });
        embedders.set(model, fake);
        return Promise.resolve(fake);
      },
      cache: false
    });
    expect(await controller.start()).toBe(true);
    expect(controller.model).toBe(DEFAULT_MODEL_ID);
    const datasets = await loadDatasets(["target"]);
    const first = controller.attach(buildCatalog(datasets, 1));
    await first?.ready;
    expect(controller.state).toMatchObject({ kind: "ready", model: DEFAULT_MODEL_ID });
    const embeddedByDefault = embedders.get(DEFAULT_MODEL_ID)?.calls.document ?? 0;
    expect(embeddedByDefault).toBeGreaterThan(0);

    // Same model: a no-op. Another model: the running embedder is dropped and replaced.
    expect(await controller.start(DEFAULT_MODEL_ID)).toBe(true);
    expect(embedders.size).toBe(1);
    expect(await controller.start(JINA)).toBe(true);
    expect(controller.model).toBe(JINA);
    expect(controller.index).toBeUndefined();
    const second = controller.attach(buildCatalog(datasets, 2));
    await second?.ready;
    expect(controller.state).toMatchObject({ kind: "ready", model: JINA });
    expect(embedders.get(JINA)?.calls.document).toBe(embeddedByDefault);
    expect(embedders.get(DEFAULT_MODEL_ID)?.calls.document).toBe(embeddedByDefault);
    controller.dispose();
  });

  it("switches models from the actions layer while semantic search is on", async () => {
    installExamplesFetch();
    const started: string[] = [];
    const semantic = createSemanticController({
      createEmbedder: (model) => {
        started.push(model);
        return Promise.resolve(createFakeEmbedder({ id: `fake:${model}`, model }));
      },
      cache: false
    });
    const store = createStore(
      initialState({ theme: "light", semantic: false, semanticModel: DEFAULT_MODEL_ID })
    );
    const actions = createActions(store, {
      semantic,
      yield: () => Promise.resolve(),
      detectWebGpu: () => Promise.resolve(true)
    });
    await actions.boot();
    expect(store.get().webGpu).toBe(true);
    await actions.loadExamples();
    await actions.setSemantic(true);
    await until(() => store.get().semantic.kind === "ready", 10_000, "ready on the default model");
    expect(store.get().semantic).toMatchObject({ kind: "ready", model: DEFAULT_MODEL_ID });

    await actions.setSemanticModel(JINA);
    expect(store.get().prefs.semanticModel).toBe(JINA);
    expect(loadPrefs().semanticModel).toBe(JINA);
    await until(() => store.get().semantic.kind === "ready", 10_000, "ready on Jina");
    expect(store.get().semantic).toMatchObject({ kind: "ready", model: JINA });
    expect(started).toEqual([DEFAULT_MODEL_ID, JINA]);
    expect(store.get().notices.some((notice) => notice.text.includes("Loading Jina v5 nano"))).toBe(true);

    actions.setQuery("cigarette");
    await until(() => store.get().search.result?.semantic.state === "complete", 10_000, "complete result");
    expect(store.get().search.result?.totalRelated).toBeGreaterThan(0);

    // Choosing the current model again changes nothing; an unknown id is ignored.
    await actions.setSemanticModel(JINA);
    await actions.setSemanticModel("nobody/unknown");
    expect(started).toHaveLength(2);
    expect(store.get().prefs.semanticModel).toBe(JINA);
    semantic.dispose();
  });

  it("falls back to the default model when the saved model needs WebGPU and there is none", async () => {
    const started: string[] = [];
    const semantic = createSemanticController({
      createEmbedder: (model) => {
        started.push(model);
        return Promise.resolve(createFakeEmbedder({ model }));
      },
      cache: false
    });
    const store = createStore(initialState({ theme: "light", semantic: true, semanticModel: JINA }));
    const actions = createActions(store, {
      semantic,
      yield: () => Promise.resolve(),
      detectWebGpu: () => Promise.resolve(false)
    });
    await actions.boot();
    expect(store.get().webGpu).toBe(false);
    expect(store.get().prefs.semanticModel).toBe(DEFAULT_MODEL_ID);
    expect(store.get().notices.some((notice) => notice.text.includes("needs WebGPU"))).toBe(true);
    await until(() => store.get().semantic.kind === "ready", 10_000, "ready");
    expect(started).toEqual([DEFAULT_MODEL_ID]);

    // Picking it by hand is refused too (the picker disables it, but the action guards as well).
    await actions.setSemanticModel(JINA);
    expect(store.get().prefs.semanticModel).toBe(DEFAULT_MODEL_ID);
    expect(started).toHaveLength(1);
    semantic.dispose();
  });
});
