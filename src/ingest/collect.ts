// Gather files (with relative paths) from the three ways a browser hands them over: a file
// input, a folder input (webkitdirectory) and drag-and-drop, where dropped directories are
// walked through the File System Entry API.

import type { RawFile } from "./filter";

export interface Collected {
  files: RawFile[];
  /** Everything the selection held, including files that will be ignored. */
  scanned: number;
  /** Paths the browser refused to read. */
  failures: string[];
}

/** `<input type="file" multiple>` and `<input webkitdirectory>` (paths come from webkitRelativePath). */
export function collectFromFileList(list: FileList | readonly File[]): Collected {
  const files: RawFile[] = [];
  for (const file of Array.from(list)) {
    files.push({ path: file.webkitRelativePath || file.name, file, size: file.size });
  }
  return { files, scanned: files.length, failures: [] };
}

/**
 * Drag-and-drop. Must be called synchronously inside the `drop` handler: `webkitGetAsEntry()`
 * only works while the event is being dispatched. Returns `undefined` when the browser has no
 * entry API, in which case the caller falls back to `collectFromFileList(dt.files)`.
 * `label` is the directory name when exactly one directory was dropped.
 */
export function collectFromDataTransfer(
  dt: DataTransfer
): { label: string | undefined; done: Promise<Collected> } | undefined {
  const items = Array.from(dt.items ?? []);
  if (items.length === 0 || typeof items[0]?.webkitGetAsEntry !== "function") return undefined;
  const entries = items
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0) return undefined;
  const label = entries.length === 1 && entries[0]?.isDirectory ? entries[0].name : undefined;
  const out: Collected = { files: [], scanned: 0, failures: [] };
  const done = Promise.all(entries.map((entry) => walkEntry(entry, "", out))).then(() => {
    out.scanned = out.files.length;
    return out;
  });
  return { label, done };
}

/** Recursively read a dropped entry (unbounded depth: people drop repository roots). */
export function walkEntry(entry: FileSystemEntry, prefix: string, out: Collected): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (file) => {
          out.files.push({ path: prefix + entry.name, file, size: file.size });
          resolve();
        },
        () => {
          out.failures.push(prefix + entry.name);
          resolve();
        }
      );
    } else if (entry.isDirectory) {
      const dir = `${prefix}${entry.name}/`;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readBatch = (): void => {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              resolve();
              return;
            }
            // readEntries yields in chunks; keep reading until an empty batch.
            void Promise.all(batch.map((child) => walkEntry(child, dir, out))).then(readBatch);
          },
          () => {
            out.failures.push(dir);
            resolve();
          }
        );
      };
      readBatch();
    } else {
      resolve();
    }
  });
}
