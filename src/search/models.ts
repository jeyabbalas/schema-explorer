// The embedding models the app offers for semantic search. Every entry must be in the
// library's verified table (KNOWN_EMBEDDING_MODELS), which supplies pooling, prefixes, the
// per-device weight precision and the cosine floor; this file only adds what the picker shows.

import { DEFAULT_EMBEDDING_MODEL, KNOWN_EMBEDDING_MODELS } from "json-schema-data-dictionary";

export interface EmbeddingModelOption {
  /** Hugging Face model id. */
  id: string;
  /** Short display name. */
  name: string;
  /** Parameter count, formatted ("23M"). */
  params: string;
  /** SPDX licence identifier of the weights. */
  license: string;
  /** Download size on the device the model runs on. */
  download: string;
  /** One line on what the model is good at. */
  summary: string;
  /** Verified on WebGPU only (far too large for single-threaded WASM). */
  needsWebGpu: boolean;
  /** Weights licensed for non-commercial use only. */
  nonCommercial: boolean;
}

export const DEFAULT_MODEL_ID: string = DEFAULT_EMBEDDING_MODEL;

/** Picker copy per model; order = picker order. */
const MODEL_COPY: ReadonlyArray<Pick<EmbeddingModelOption, "id" | "name" | "download" | "summary">> = [
  {
    id: "MongoDB/mdbr-leaf-ir",
    name: "LEAF-IR",
    download: "23–46 MB",
    summary: "Small and quick to index; runs on WebGPU or WASM."
  },
  {
    // Google's multimodal EmbeddingGemma 2 loaded as its text model alone (the library drops the
    // vision and audio encoders from the config, so their weights are never fetched).
    id: "onnx-community/embeddinggemma-2-ONNX",
    name: "EmbeddingGemma 2",
    download: "190 MB",
    summary: "Strong retrieval in 100+ languages, free for commercial use; needs WebGPU."
  },
  {
    id: "jinaai/jina-embeddings-v5-text-nano-retrieval",
    name: "Jina v5 nano",
    download: "124 MB",
    summary: "Highest retrieval quality; needs WebGPU."
  }
];

/** A model verified on WebGPU alone. */
export function isWebGpuOnly(id: string): boolean {
  const devices = KNOWN_EMBEDDING_MODELS[id]?.devices;
  return devices !== undefined && devices.length > 0 && devices.every((device) => device === "webgpu");
}

function formatParams(params: number): string {
  return `${Math.round(params / 1e6)}M`;
}

export const EMBEDDING_MODELS: readonly EmbeddingModelOption[] = MODEL_COPY.flatMap((copy) => {
  const known = KNOWN_EMBEDDING_MODELS[copy.id];
  if (!known) {
    console.warn(`[schema-explorer] "${copy.id}" is not a verified embedding model; not offered.`);
    return [];
  }
  return [
    {
      ...copy,
      params: formatParams(known.params),
      license: known.license,
      needsWebGpu: isWebGpuOnly(copy.id),
      nonCommercial: /-NC\b/i.test(known.license)
    }
  ];
});

export function findModel(id: string): EmbeddingModelOption | undefined {
  return EMBEDDING_MODELS.find((model) => model.id === id);
}

export function isModelId(value: unknown): value is string {
  return typeof value === "string" && findModel(value) !== undefined;
}

/** The display name of a model, or the id itself when it is not in the picker. */
export function modelName(id: string): string {
  return findModel(id)?.name ?? id;
}
