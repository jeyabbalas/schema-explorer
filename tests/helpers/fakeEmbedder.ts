// Deterministic bag-of-words embedder for tests (a TypeScript port of the library's own test
// helper): each token is hashed into one of `dims` buckets; a tiny synonym map makes
// "climacteric" land next to "menopause" and "cigarette" next to "smoking". Unit-normalised, so
// dot products are cosine similarities. No model download anywhere.

import type { EmbedKind, Embedder } from "json-schema-data-dictionary";

const SYNONYMS: Record<string, string> = {
  climacteric: "meno",
  menopause: "meno",
  menopausal: "meno",
  meno: "meno",
  cigarette: "tobacco",
  cigarettes: "tobacco",
  smoking: "tobacco",
  smoke: "tobacco",
  smoker: "tobacco",
  tobacco: "tobacco"
};

function fnv(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface FakeEmbedderOptions {
  dims?: number;
  id?: string;
  minScore?: number;
  delayMs?: number;
  /** Throw when a text containing this string is embedded. */
  failOn?: string;
  /** Reject `load()` with this message. */
  failLoad?: string;
}

export interface FakeEmbedder extends Embedder {
  calls: { document: number; query: number; loads: number; texts: string[] };
}

export function createFakeEmbedder(options: FakeEmbedderOptions = {}): FakeEmbedder {
  const dims = options.dims ?? 512;
  const calls = { document: 0, query: 0, loads: 0, texts: [] as string[] };

  const vec = (text: string): Float32Array => {
    const v = new Float32Array(dims);
    for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      const token = SYNONYMS[raw] ?? raw;
      const bucket = fnv(token) % dims;
      v[bucket] = (v[bucket] ?? 0) + 1;
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dims; i += 1) v[i] = (v[i] as number) / norm;
    return v;
  };

  return {
    id: options.id ?? "fake-bow-v1",
    minScore: options.minScore ?? 0.3,
    info: { model: "fake-bow", device: "cpu", dtype: "fp32", dims },
    calls,
    load(onProgress) {
      calls.loads += 1;
      if (options.failLoad) return Promise.reject(new Error(options.failLoad));
      onProgress?.(0.5);
      onProgress?.(1);
      return Promise.resolve();
    },
    async embed(texts: readonly string[], kind: EmbedKind) {
      calls[kind] += texts.length;
      calls.texts.push(...texts);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      for (const text of texts) {
        if (options.failOn && text.includes(options.failOn)) throw new Error(`fail: ${options.failOn}`);
      }
      return texts.map(vec);
    }
  };
}
