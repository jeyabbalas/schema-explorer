// Pure path helpers for uploaded selections.

/** Forward slashes, no leading "./" or "/", no empty segments. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

/**
 * Drop the leading directory segments shared by ALL paths, so dropping `study/` produces
 * exactly what dropping `study/json_schema/` does and relative `$ref`s line up with the paths.
 * Only whole directory segments count; the file name is never stripped.
 */
export function stripCommonPrefix(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  let common = (paths[0] as string).split("/").slice(0, -1);
  for (let i = 1; i < paths.length && common.length > 0; i += 1) {
    const segments = (paths[i] as string).split("/").slice(0, -1);
    let n = 0;
    while (n < common.length && n < segments.length && common[n] === segments[n]) n += 1;
    common = common.slice(0, n);
  }
  if (common.length === 0) return [...paths];
  const cut = common.join("/").length + 1;
  return paths.map((path) => path.slice(cut));
}

export function basename(path: string): string {
  return path.split("/").pop() || path;
}

/** "x.schema.json" -> "x", "x.json" -> "x". */
export function fileStem(name: string): string {
  return basename(name)
    .replace(/\.schema\.json$/i, "")
    .replace(/\.json$/i, "");
}

/** The first directory segment when every path starts with the same one; else undefined. */
export function commonFirstDirectory(paths: readonly string[]): string | undefined {
  let first: string | undefined;
  for (const path of paths) {
    const index = path.indexOf("/");
    if (index < 0) return undefined;
    const segment = path.slice(0, index);
    if (first === undefined) first = segment;
    else if (segment !== first) return undefined;
  }
  return first;
}

/**
 * Label for a batch: the explicit label (a dropped directory, an example group), else the folder
 * every ORIGINAL path shares (folder pickers and entry walks prefix the chosen folder's name),
 * else undefined (the caller falls back to the root file's name).
 */
export function deriveGroupLabel(originalPaths: readonly string[], explicit?: string): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  return commonFirstDirectory(originalPaths.map(normalizePath));
}

/** "BGS", "BGS (2)", "BGS (3)", … until the label is free. */
export function uniqueLabel(label: string, taken: ReadonlySet<string>): string {
  if (!taken.has(label)) return label;
  for (let n = 2; ; n += 1) {
    const candidate = `${label} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}
