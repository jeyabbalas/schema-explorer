// Builds the Transformers.js embedder. Shared by the worker (normal path) and the main-thread
// fallback (when workers are unavailable). Transformers.js itself is loaded on demand from a
// pinned CDN URL; model weights come from the Hugging Face Hub and are cached by the browser.

import {
  createTransformersEmbedder,
  type Embedder,
  type TransformersModuleLike
} from "json-schema-data-dictionary";
import { EMBEDDING_MODEL, TRANSFORMERS_URL } from "./constants";

export interface LocalEmbedderOptions {
  /** "auto" (WebGPU when available, else WASM), "webgpu" or "wasm". */
  device?: string | undefined;
  /** Weight precision ("auto", "q8", "fp16", …). */
  dtype?: string | undefined;
  batchSize?: number | undefined;
}

export async function loadTransformers(): Promise<TransformersModuleLike> {
  const module = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as TransformersModuleLike;
  // Never probe this origin for local model files: everything comes from the Hub.
  if (module.env) module.env.allowLocalModels = false;
  return module;
}

export function createLocalEmbedder(options: LocalEmbedderOptions = {}): Embedder {
  return createTransformersEmbedder(loadTransformers, {
    model: EMBEDDING_MODEL,
    device: options.device ?? "auto",
    dtype: options.dtype ?? "auto",
    batchSize: options.batchSize
  });
}
