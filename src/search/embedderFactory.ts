// Builds the Transformers.js embedder. Shared by the worker (normal path) and the main-thread
// fallback (when workers are unavailable). Transformers.js itself is loaded on demand from a
// pinned CDN URL; model weights come from the Hugging Face Hub and are cached by the browser.

import {
  createTransformersEmbedder,
  type Embedder,
  type TransformersModuleLike
} from "json-schema-data-dictionary";
import { TRANSFORMERS_URL } from "./constants";
import { DEFAULT_MODEL_ID, isWebGpuOnly } from "./models";

export interface LocalEmbedderOptions {
  /** Hugging Face model id; default: the app's default model. */
  model?: string | undefined;
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

/**
 * The device to request when none was given: "auto" lets the library pick WebGPU or WASM and
 * retry on WASM when the WebGPU session fails. A model verified on WebGPU alone asks for
 * WebGPU explicitly instead, so a broken GPU path fails fast rather than crawling on the CPU
 * for minutes.
 */
export function defaultDeviceFor(model: string): string {
  return isWebGpuOnly(model) ? "webgpu" : "auto";
}

export function createLocalEmbedder(options: LocalEmbedderOptions = {}): Embedder {
  const model = options.model ?? DEFAULT_MODEL_ID;
  return createTransformersEmbedder(loadTransformers, {
    model,
    device: options.device ?? defaultDeviceFor(model),
    dtype: options.dtype ?? "auto",
    batchSize: options.batchSize
  });
}
