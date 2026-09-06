// Test access to the bundled example sets: read them from disk in the shape ingestion expects,
// and serve them through a stubbed `fetch` for code paths that load them over HTTP.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { isExampleManifest, type ExampleGroup, type ExampleManifest } from "../../src/examples/manifest";
import type { TextFile } from "../../src/ingest/parse";

export const EXAMPLES_DIR = join(__dirname, "..", "..", "public", "examples");

export function loadExampleManifest(): ExampleManifest {
  const parsed: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, "manifest.json"), "utf8"));
  if (!isExampleManifest(parsed)) throw new Error("manifest.json does not match the manifest format");
  return parsed;
}

/** One example group as `{ path, text }` files, i.e. exactly what a folder drop yields after reading. */
export function readExampleGroup(id: string): { group: ExampleGroup; files: TextFile[] } {
  const group = loadExampleManifest().groups.find((candidate) => candidate.id === id);
  if (!group) throw new Error(`unknown example group ${id}`);
  const files = group.files.map((file) => ({
    path: file.path,
    text: readFileSync(join(EXAMPLES_DIR, id, file.path), "utf8"),
    bytes: file.bytes
  }));
  return { group, files };
}

export function readAllExampleGroups(): Array<{ group: ExampleGroup; files: TextFile[] }> {
  return loadExampleManifest().groups.map((group) => readExampleGroup(group.id));
}

/** Serve any URL whose path contains `/examples/` from public/examples on disk; 404 otherwise. */
export function installExamplesFetch(): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const marker = url.indexOf("/examples/");
    if (marker < 0) return Promise.resolve(new Response("not found", { status: 404 }));
    const relative = decodeURIComponent((url.slice(marker + "/examples/".length).split("?")[0] ?? "").trim());
    try {
      const body = readFileSync(join(EXAMPLES_DIR, relative), "utf8");
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })
      );
    } catch {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
  });
}
