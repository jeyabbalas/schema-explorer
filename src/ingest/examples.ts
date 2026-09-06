// Fetch the bundled example sets (public/examples/) so they flow through the same ingestion as a
// dropped folder.

import { isExampleManifest, type ExampleGroup, type ExampleManifest } from "../examples/manifest";
import { mapWithConcurrency } from "../util/async";
import { errorMessage } from "../util/text";
import type { TextFile } from "./parse";

export function examplesUrl(...parts: string[]): string {
  return `${import.meta.env.BASE_URL}examples/${parts.join("/")}`;
}

export async function fetchExampleManifest(signal?: AbortSignal): Promise<ExampleManifest> {
  const response = await fetch(examplesUrl("manifest.json"), signal ? { signal } : {});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json: unknown = await response.json();
  if (!isExampleManifest(json)) throw new Error("the example manifest is malformed");
  return json;
}

export async function fetchExampleGroup(
  group: ExampleGroup,
  options: {
    signal?: AbortSignal | undefined;
    onProgress?: ((done: number, total: number) => void) | undefined;
  } = {}
): Promise<{ files: TextFile[]; errors: string[] }> {
  const errors: string[] = [];
  let done = 0;
  const results = await mapWithConcurrency(group.files, 6, async (file): Promise<TextFile | undefined> => {
    try {
      const response = await fetch(
        examplesUrl(group.id, file.path),
        options.signal ? { signal: options.signal } : {}
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { path: file.path, text: await response.text(), bytes: file.bytes };
    } catch (err) {
      errors.push(`${group.id}/${file.path}: ${errorMessage(err)}`);
      return undefined;
    } finally {
      done += 1;
      options.onProgress?.(done, group.files.length);
    }
  });
  return { files: results.filter((file): file is TextFile => file !== undefined), errors };
}
