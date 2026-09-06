import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isExampleManifest, type ExampleManifest } from "../src/examples/manifest";

// The bundled example sets are committed copies of the CD3 pilot schemas. These checks keep the
// manifest, the files on disk and the pinned dataset counts consistent with each other.
const EXAMPLES_DIR = join(__dirname, "..", "public", "examples");
const META_FILES = new Set(["LICENSE", "manifest.json", "manifest.schema.json"]);

function loadManifest(): ExampleManifest {
  const parsed: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, "manifest.json"), "utf8"));
  if (!isExampleManifest(parsed)) throw new Error("manifest.json does not match the manifest format");
  return parsed;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [relative(EXAMPLES_DIR, path)];
  });
}

describe("bundled example manifest", () => {
  const manifest = loadManifest();

  it("lists four groups with unique kebab-case ids", () => {
    const ids = manifest.groups.map((group) => group.id);
    expect(ids).toEqual(["bgs", "mws", "ofh", "target"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references files that exist with the recorded sizes", () => {
    for (const group of manifest.groups) {
      let total = 0;
      for (const file of group.files) {
        const size = statSync(join(EXAMPLES_DIR, group.id, file.path)).size;
        expect(size, `${group.id}/${file.path}`).toBe(file.bytes);
        total += size;
      }
      expect(group.bytes, group.id).toBe(total);
    }
    const total = manifest.groups.reduce((sum, group) => sum + group.bytes, 0);
    expect(total).toBeLessThan(1024 * 1024);
  });

  it("has no stray files on disk (every file is listed or is metadata)", () => {
    const listed = new Set(
      manifest.groups.flatMap((group) => group.files.map((f) => `${group.id}/${f.path}`))
    );
    const onDisk = walk(EXAMPLES_DIR).filter((path) => !META_FILES.has(path));
    expect(onDisk.sort()).toEqual([...listed].sort());
  });

  it("redistributes the upstream license and attribution", () => {
    const license = readFileSync(join(EXAMPLES_DIR, manifest.source.licenseFile), "utf8");
    expect(license).toContain("MIT License");
    expect(license).toContain("mgarciaclosas");
    expect(manifest.source.url).toContain("github.com/mgarciaclosas/cd3-schemify-pilot");
  });

  it("pins the expected table sizes", () => {
    const byId = new Map(manifest.groups.map((group) => [group.id, group]));
    const counts = (id: string) =>
      byId
        .get(id)
        ?.datasets.map((d) => [d.variables, d.categories])
        .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    expect(counts("bgs")).toEqual([[60, 12]]);
    expect(counts("mws")).toEqual([[38, 7]]);
    expect(counts("ofh")).toEqual([
      [14, 1],
      [359, 6]
    ]);
    expect(counts("target")).toEqual([[5, 1]]);
  });
});
