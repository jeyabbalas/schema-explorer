import { mapWithConcurrency, yieldToBrowser } from "../util/async";
import { errorMessage } from "../util/text";
import type { RawFile } from "./filter";

/** A parsed JSON file (not yet known to be a schema). */
export interface ParsedDoc {
  path: string;
  name: string;
  text: string;
  schema: unknown;
  bytes: number;
}

export interface ParseError {
  path: string;
  message: string;
}

export interface TextFile {
  path: string;
  text: string;
  bytes?: number | undefined;
}

const YIELD_EVERY_BYTES = 2 * 1024 * 1024;

function nameOf(path: string): string {
  return path.split("/").pop() || path;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parse already-read texts (examples, restored batches). Never throws: bad files land in `errors`. */
export function parseTexts(files: readonly TextFile[]): { docs: ParsedDoc[]; errors: ParseError[] } {
  const docs: ParsedDoc[] = [];
  const errors: ParseError[] = [];
  for (const file of files) {
    const text = stripBom(file.text);
    try {
      docs.push({
        path: file.path,
        name: nameOf(file.path),
        text,
        schema: JSON.parse(text) as unknown,
        bytes: file.bytes ?? text.length
      });
    } catch (err) {
      errors.push({ path: file.path, message: errorMessage(err) });
    }
  }
  return { docs, errors };
}

/** Read and parse files, yielding to the browser every couple of megabytes so progress can paint. */
export async function readAndParse(
  files: readonly RawFile[],
  onProgress?: (done: number, total: number) => void
): Promise<{ docs: ParsedDoc[]; errors: ParseError[] }> {
  const docs: ParsedDoc[] = [];
  const errors: ParseError[] = [];
  let done = 0;
  let sinceYield = 0;
  await mapWithConcurrency(files, 8, async (file) => {
    let text: string;
    try {
      text = stripBom(await file.file.text());
    } catch (err) {
      errors.push({ path: file.path, message: `could not read the file (${errorMessage(err)})` });
      done += 1;
      onProgress?.(done, files.length);
      return;
    }
    try {
      docs.push({
        path: file.path,
        name: nameOf(file.path),
        text,
        schema: JSON.parse(text) as unknown,
        bytes: file.size
      });
    } catch (err) {
      errors.push({ path: file.path, message: errorMessage(err) });
    }
    done += 1;
    onProgress?.(done, files.length);
    sinceYield += file.size;
    if (sinceYield >= YIELD_EVERY_BYTES) {
      sinceYield = 0;
      await yieldToBrowser();
    }
  });
  // Directory walks arrive in whatever order the browser yields: sort for stable output.
  docs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  errors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { docs, errors };
}
