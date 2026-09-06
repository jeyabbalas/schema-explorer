// The embedding worker: runs the text-embedding model off the main thread so indexing never
// janks the page. Configuration (the model, plus dev/test overrides) travels in the worker's
// `name`, which keeps the `new Worker(new URL(...))` call site literal for the bundler.

import { serveEmbedder } from "json-schema-data-dictionary";
import { WORKER_BATCH_SIZE } from "./constants";
import { createLocalEmbedder, type LocalEmbedderOptions } from "./embedderFactory";

interface WorkerConfig extends LocalEmbedderOptions {
  /** Test hook: hide WebGPU so the WASM path is exercised. */
  nogpu?: boolean | undefined;
}

function readConfig(): WorkerConfig {
  try {
    const parsed: unknown = JSON.parse(self.name || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

const config = readConfig();
if (config.nogpu) {
  try {
    const scope = globalThis as { WorkerNavigator?: { prototype: Record<string, unknown> } };
    if (scope.WorkerNavigator) delete scope.WorkerNavigator.prototype.gpu;
  } catch {
    /* best effort */
  }
}

serveEmbedder(
  createLocalEmbedder({
    model: config.model,
    device: config.device,
    dtype: config.dtype,
    batchSize: WORKER_BATCH_SIZE
  })
);
