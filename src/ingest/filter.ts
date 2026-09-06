// First stage of ingestion: decide which of the selected files are worth reading at all.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_BATCH_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 2000;

export type IgnoreReason = "not-json" | "hidden" | "too-large" | "batch-too-large" | "too-many";

/** A file as selected or dropped, with its path relative to the selection. */
export interface RawFile {
  path: string;
  file: Blob;
  size: number;
}

export interface IgnoredFile {
  path: string;
  reason: IgnoreReason;
}

export function isJsonName(name: string): boolean {
  return /\.json$/i.test(name);
}

/** Any path segment starting with "." (.DS_Store, .git/…, .idea/…). */
export function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

export function describeIgnoreReason(reason: IgnoreReason): string {
  switch (reason) {
    case "not-json":
      return "not a .json file";
    case "hidden":
      return "hidden file";
    case "too-large":
      return `larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB`;
    case "batch-too-large":
      return `selection exceeds ${MAX_BATCH_BYTES / (1024 * 1024)} MB`;
    case "too-many":
      return `more than ${MAX_FILES} files`;
  }
}

/** Keep readable JSON files within the size caps; report everything else with a reason. */
export function filterFiles(files: readonly RawFile[]): { kept: RawFile[]; ignored: IgnoredFile[] } {
  const kept: RawFile[] = [];
  const ignored: IgnoredFile[] = [];
  let total = 0;
  for (const file of files) {
    if (isHiddenPath(file.path)) {
      ignored.push({ path: file.path, reason: "hidden" });
    } else if (!isJsonName(file.path)) {
      ignored.push({ path: file.path, reason: "not-json" });
    } else if (file.size > MAX_FILE_BYTES) {
      ignored.push({ path: file.path, reason: "too-large" });
    } else if (kept.length >= MAX_FILES) {
      ignored.push({ path: file.path, reason: "too-many" });
    } else if (total + file.size > MAX_BATCH_BYTES) {
      ignored.push({ path: file.path, reason: "batch-too-large" });
    } else {
      kept.push(file);
      total += file.size;
    }
  }
  return { kept, ignored };
}
