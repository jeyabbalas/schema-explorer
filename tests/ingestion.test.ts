import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDatasets, chooseRoots, defaultLabel, splitIntoGroups, MAX_DATASETS } from "../src/ingest/build";
import { filterFiles, type RawFile } from "../src/ingest/filter";
import { hashDocs } from "../src/ingest/hash";
import { ingest, type IngestContext } from "../src/ingest/index";
import { parseTexts, readAndParse } from "../src/ingest/parse";
import {
  deriveGroupLabel,
  fileStem,
  normalizePath,
  stripCommonPrefix,
  uniqueLabel
} from "../src/ingest/paths";
import { looksLikeSchemaDocument } from "../src/ingest/schemaLike";
import { fetchExampleGroup, fetchExampleManifest } from "../src/ingest/examples";
import { colorAllocator } from "../src/state/selectors";
import type { Dataset, LoadBatch } from "../src/state/types";
import { installExamplesFetch, readAllExampleGroups, readExampleGroup } from "./helpers/examples";

function context(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    existingDatasets: [],
    existingBatches: [],
    maxDatasets: MAX_DATASETS,
    nextColor: colorAllocator([]),
    now: () => 1_700_000_000_000,
    ...overrides
  };
}

const counts = (datasets: readonly Dataset[]) =>
  datasets.map((d) => ({ label: d.label, variables: d.variableCount, categories: d.categoryCount }));

describe("paths", () => {
  it("strips the directories every path shares, never the file name", () => {
    expect(stripCommonPrefix(["study/json_schema/a.json", "study/json_schema/categories/b.json"])).toEqual([
      "a.json",
      "categories/b.json"
    ]);
    expect(stripCommonPrefix(["only/one/file.json"])).toEqual(["file.json"]);
    expect(stripCommonPrefix(["a/x.json", "b/y.json"])).toEqual(["a/x.json", "b/y.json"]);
    expect(stripCommonPrefix(["x.json", "y.json"])).toEqual(["x.json", "y.json"]);
    expect(stripCommonPrefix([])).toEqual([]);
  });

  it("normalises separators and leading dots", () => {
    expect(normalizePath("./a\\b//c.json")).toBe("a/b/c.json");
    expect(normalizePath("/root/x.json")).toBe("root/x.json");
  });

  it("derives labels and stems", () => {
    expect(fileStem("derived_variables.schema.json")).toBe("derived_variables");
    expect(fileStem("dir/defs.json")).toBe("defs");
    expect(deriveGroupLabel(["BGS/a.json", "BGS/categories/b.json"])).toBe("BGS");
    expect(deriveGroupLabel(["a.json", "b.json"])).toBeUndefined();
    expect(deriveGroupLabel(["a/x.json", "b/y.json"], "Dropped")).toBe("Dropped");
    expect(uniqueLabel("BGS", new Set(["BGS", "BGS (2)"]))).toBe("BGS (3)");
    expect(defaultLabel("OFH", "questionnaire/questionnaire.schema.json", 2)).toBe("OFH · questionnaire");
    expect(defaultLabel(undefined, "target.schema.json", 1)).toBe("target");
  });
});

describe("file filtering", () => {
  const raw = (path: string, size = 10): RawFile => ({ path, file: new Blob(["{}"]), size });

  it("keeps JSON files and reports everything else with a reason", () => {
    const { kept, ignored } = filterFiles([
      raw("BGS/json_schema/common/defs.json"),
      raw("BGS/json_schema/dictionary.html"),
      raw("BGS/json_schema/VARIABLES.csv"),
      raw("BGS/json_schema/PROGRESS.md"),
      raw("BGS/json_schema/assets/VERSION"),
      raw("BGS/json_schema/.DS_Store"),
      raw("BGS/.git/config.json"),
      raw("Upper.JSON"),
      raw("huge.json", 30 * 1024 * 1024)
    ]);
    expect(kept.map((f) => f.path)).toEqual(["BGS/json_schema/common/defs.json", "Upper.JSON"]);
    expect(ignored.map((f) => f.reason)).toEqual([
      "not-json",
      "not-json",
      "not-json",
      "not-json",
      "hidden",
      "hidden",
      "too-large"
    ]);
  });
});

describe("parsing and schema detection", () => {
  it("reports invalid JSON per file without aborting the batch", async () => {
    const files: RawFile[] = [
      { path: "b.json", file: new Blob(["{ nope"]), size: 6 },
      { path: "a.json", file: new Blob(['﻿{"type":"object"}']), size: 18 }
    ];
    const { docs, errors } = await readAndParse(files);
    expect(docs.map((d) => d.path)).toEqual(["a.json"]);
    expect(docs[0]?.schema).toEqual({ type: "object" });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("b.json");
  });

  it("recognises schemas but not data arrays or ledgers", () => {
    expect(looksLikeSchemaDocument({ $schema: "x", type: "array" })).toBe(true);
    expect(looksLikeSchemaDocument({ properties: {} })).toBe(true);
    expect(looksLikeSchemaDocument([{ TCode: "A" }])).toBe(false);
    expect(looksLikeSchemaDocument({ rowIndexBase: 0, violations: [] })).toBe(false);
    expect(looksLikeSchemaDocument("text")).toBe(false);
    const { docs } = parseTexts([{ path: "x.json", text: '{"title":"only a title"}' }]);
    expect(looksLikeSchemaDocument(docs[0]?.schema)).toBe(false);
  });
});

describe("dataset construction from the example sets", () => {
  it("builds the expected datasets with no unresolved references", async () => {
    const expected: Record<string, Array<{ label: string; variables: number; categories: number }>> = {
      bgs: [{ label: "BGS", variables: 60, categories: 12 }],
      mws: [{ label: "MWS", variables: 38, categories: 7 }],
      ofh: [
        { label: "OFH · participant", variables: 14, categories: 1 },
        { label: "OFH · questionnaire", variables: 359, categories: 6 }
      ],
      target: [{ label: "TARGET", variables: 5, categories: 1 }]
    };
    for (const { group, files } of readAllExampleGroups()) {
      const result = await ingest({ kind: "texts", label: group.label, source: "example", files }, context());
      const datasets = result.outcomes.flatMap((o) => o.datasets);
      expect(counts(datasets), group.id).toEqual(expected[group.id]);
      for (const dataset of datasets) {
        expect(dataset.warnings, `${dataset.label} warnings`).toEqual([]);
        expect(dataset.title).toBeTruthy();
        expect(dataset.table.rows.length).toBe(dataset.variableCount);
      }
      expect(result.notices.filter((n) => n.level === "error")).toEqual([]);
      expect(result.outcomes[0]?.batch?.docs.length).toBe(files.length);
    }
  });

  it("chooses distinct colours for the two OFH tables", async () => {
    const { group, files } = readExampleGroup("ofh");
    const result = await ingest({ kind: "texts", label: group.label, source: "example", files }, context());
    const colours = result.outcomes.flatMap((o) => o.datasets).map((d) => d.colorIndex);
    expect(colours).toEqual([0, 1]);
  });

  it("gives the same result when the selection starts one directory higher", async () => {
    const { group, files } = readExampleGroup("bgs");
    const deeper = files.map((f) => ({ ...f, path: `cd3-schemify-pilot-main/BGS/json_schema/${f.path}` }));
    const direct = await ingest({ kind: "texts", label: group.label, source: "upload", files }, context());
    const nested = await ingest(
      { kind: "texts", label: group.label, source: "upload", files: deeper },
      context()
    );
    const directDs = direct.outcomes[0]?.datasets[0];
    const nestedDs = nested.outcomes[0]?.datasets[0];
    expect(nestedDs?.contentHash).toBe(directDs?.contentHash);
    expect(nestedDs?.rootPath).toBe("derived_variables/derived_variables.schema.json");
    expect(nested.outcomes[0]?.batch?.hash).toBe(direct.outcomes[0]?.batch?.hash);
  });

  it("splits a multi-cohort folder into one batch per cohort", async () => {
    const files = readAllExampleGroups().flatMap(({ group, files }) =>
      files.map((f) => ({ ...f, path: `pilot/${group.label}/${f.path}` }))
    );
    const result = await ingest({ kind: "texts", label: undefined, source: "upload", files }, context());
    expect(result.outcomes.map((o) => o.batch?.label)).toEqual(["BGS", "MWS", "OFH", "TARGET"]);
    expect(counts(result.outcomes.flatMap((o) => o.datasets)).map((c) => c.label)).toEqual([
      "BGS",
      "MWS",
      "OFH · participant",
      "OFH · questionnaire",
      "TARGET"
    ]);
  });

  it("keeps a schemas + common layout as one batch", () => {
    const { docs } = parseTexts([
      { path: "schemas/root.json", text: '{"type":"array","items":{"$ref":"../common/row.json"}}' },
      { path: "common/row.json", text: '{"type":"object","properties":{"a":{"type":"string"}}}' }
    ]);
    expect(splitIntoGroups(docs)).toHaveLength(1);
  });

  it("ignores data arrays and ledgers mixed into a folder", async () => {
    const { group, files } = readExampleGroup("bgs");
    const mixed = [
      ...files,
      { path: "examples/toy_valid.json", text: JSON.stringify([{ TCode: "AAAAAAAA" }]) },
      { path: "examples/toy_invalid_ledger.json", text: JSON.stringify({ rowIndexBase: 1, violations: [] }) },
      { path: "broken.json", text: "{" }
    ];
    const result = await ingest(
      { kind: "texts", label: group.label, source: "upload", files: mixed },
      context()
    );
    expect(counts(result.outcomes.flatMap((o) => o.datasets))).toEqual([
      { label: "BGS", variables: 60, categories: 12 }
    ]);
    const info = result.notices.find((n) => n.level === "info");
    expect(info?.text).toContain("Ignored 2 JSON files");
    expect(info?.details).toEqual(["examples/toy_invalid_ledger.json", "examples/toy_valid.json"]);
    expect(result.notices.find((n) => n.level === "error")?.text).toContain("broken.json");
    expect(result.outcomes[0]?.batch?.docs.map((d) => d.path)).not.toContain("examples/toy_valid.json");
  });

  it("skips a batch that is already loaded and a dataset with identical content", async () => {
    const { group, files } = readExampleGroup("mws");
    const first = await ingest({ kind: "texts", label: group.label, source: "example", files }, context());
    const batch = first.outcomes[0]?.batch as LoadBatch;
    const datasets = first.outcomes[0]?.datasets as Dataset[];
    const again = await ingest(
      { kind: "texts", label: group.label, source: "upload", files },
      context({ existingBatches: [batch], existingDatasets: datasets })
    );
    expect(again.outcomes).toEqual([]);
    expect(again.notices.map((n) => n.text)).toEqual(["MWS is already loaded (as “MWS”); skipped."]);

    // Same content, different paths: the batch hash differs but the dictionary does not.
    const moved = files.map((f) => ({ ...f, path: `copy/${f.path}` }));
    expect(hashDocs(moved)).not.toBe(batch.hash);
    const dup = await ingest(
      { kind: "texts", label: "copy", source: "upload", files: moved },
      context({ existingDatasets: datasets, nextColor: colorAllocator(datasets) })
    );
    expect(dup.outcomes[0]?.datasets).toEqual([]);
    expect(dup.notices.some((n) => n.text.includes("identical content"))).toBe(true);
  });

  it("loads a lone object schema as a dataset and reports a defs-only file", async () => {
    const lone = await ingest(
      {
        kind: "texts",
        label: undefined,
        source: "upload",
        files: [
          {
            path: "person.json",
            text: '{"type":"object","properties":{"age":{"type":"integer","title":"Age"}}}'
          }
        ]
      },
      context()
    );
    expect(counts(lone.outcomes.flatMap((o) => o.datasets))).toEqual([
      { label: "person", variables: 1, categories: 1 }
    ]);
    const defsOnly = await ingest(
      {
        kind: "texts",
        label: "defs",
        source: "upload",
        files: [{ path: "defs.json", text: '{"$defs":{"x":{"const":1}}}' }]
      },
      context()
    );
    expect(defsOnly.outcomes[0]?.datasets).toEqual([]);
    expect(defsOnly.notices.map((n) => n.level)).toContain("info");
  });

  it("enforces the dataset cap", async () => {
    const { group, files } = readExampleGroup("ofh");
    const result = await ingest(
      { kind: "texts", label: group.label, source: "example", files },
      context({ maxDatasets: 1 })
    );
    expect(result.outcomes[0]?.datasets.map((d) => d.label)).toEqual(["OFH · participant"]);
    expect(result.notices.some((n) => n.text.includes("Dataset limit"))).toBe(true);
  });

  it("reports selections without any schema", async () => {
    const none = await ingest(
      { kind: "texts", label: undefined, source: "upload", files: [{ path: "data.json", text: "[1,2,3]" }] },
      context()
    );
    expect(none.outcomes).toEqual([]);
    expect(none.notices.map((n) => n.level)).toEqual(["info", "error"]);
    const empty = await ingest(
      {
        kind: "files",
        collected: { files: [{ path: "a.txt", file: new Blob([""]), size: 0 }], scanned: 1, failures: [] }
      },
      context()
    );
    expect(empty.notices[0]?.text).toContain("No .json files found");
    expect(empty.ignored).toEqual([{ path: "a.txt", reason: "not-json" }]);
  });

  it("chooses roots by rule", () => {
    const candidate = (uri: string, arrayLike: boolean, referenced: boolean, variableCount: number) => ({
      index: 0,
      uri,
      arrayLike,
      referenced,
      variableCount
    });
    expect(
      chooseRoots([
        candidate("b", true, false, 3),
        candidate("a", true, false, 2),
        candidate("c", false, true, 1)
      ])
    ).toEqual({
      roots: [candidate("a", true, false, 2), candidate("b", true, false, 3)],
      rule: "tables"
    });
    expect(chooseRoots([candidate("x", false, false, 2), candidate("d", false, true, 0)]).rule).toBe(
      "unreferenced"
    );
    expect(chooseRoots([candidate("d", false, true, 0)]).rule).toBe("top");
    expect(chooseRoots([]).rule).toBe("none");
  });

  it("builds directly from parsed docs (the restore path)", async () => {
    const { group, files } = readExampleGroup("target");
    const { docs } = parseTexts(files);
    const outcome = await buildDatasets(
      { batchId: "batch-1", label: group.label, source: "example", docs, createdAt: 1 },
      { existing: [], maxDatasets: MAX_DATASETS, nextColor: colorAllocator([]) }
    );
    expect(outcome.batch?.id).toBe("batch-1");
    expect(outcome.datasets[0]?.rootUri).toBe(
      "https://schema-explorer.local/batch-1/target_baseline_lifestyle.schema.json"
    );
    expect(outcome.datasets[0]?.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("example fetching", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the manifest and a group through the app's URLs", async () => {
    installExamplesFetch();
    const manifest = await fetchExampleManifest();
    expect(manifest.groups.map((g) => g.id)).toEqual(["bgs", "mws", "ofh", "target"]);
    const target = manifest.groups[3];
    if (!target) throw new Error("missing group");
    const progress: number[] = [];
    const { files, errors } = await fetchExampleGroup(target, { onProgress: (done) => progress.push(done) });
    expect(errors).toEqual([]);
    expect(files.map((f) => f.path)).toEqual(["target_baseline_lifestyle.schema.json"]);
    expect(progress).toEqual([1]);
  });
});
