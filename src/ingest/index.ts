// The one ingestion pipeline: selected/dropped files or already-read texts -> filtered, parsed,
// schema-only documents with normalised paths -> one or more batches -> datasets.

import { createNotice } from "../state/notices";
import type { BatchSource, Dataset, LoadBatch, Notice } from "../state/types";
import { newId } from "../util/id";
import { pluralize } from "../util/text";
import { buildDatasets, splitIntoGroups, type BuildOutcome } from "./build";
import type { Collected } from "./collect";
import { filterFiles, type IgnoredFile } from "./filter";
import { hashDocs } from "./hash";
import { parseTexts, readAndParse, type ParsedDoc, type ParseError, type TextFile } from "./parse";
import { deriveGroupLabel, normalizePath, stripCommonPrefix } from "./paths";
import { looksLikeSchemaDocument } from "./schemaLike";

export type IngestSource =
  | { kind: "files"; collected: Collected; label?: string | undefined }
  | { kind: "texts"; label: string | undefined; source: BatchSource; files: TextFile[] };

export interface IngestContext {
  existingDatasets: readonly Dataset[];
  existingBatches: readonly LoadBatch[];
  maxDatasets: number;
  nextColor: () => number;
  onProgress?: ((message: string, fraction?: number) => void) | undefined;
  yield?: (() => Promise<void>) | undefined;
  now?: (() => number) | undefined;
  newBatchId?: (() => string) | undefined;
}

export interface IngestResult {
  outcomes: BuildOutcome[];
  notices: Notice[];
  ignored: IgnoredFile[];
  parseErrors: ParseError[];
}

const MAX_LISTED = 20;

function listPaths(paths: readonly string[]): string[] {
  return paths.length > MAX_LISTED
    ? [...paths.slice(0, MAX_LISTED), `… and ${paths.length - MAX_LISTED} more`]
    : [...paths];
}

function relativize(docs: readonly ParsedDoc[]): ParsedDoc[] {
  const paths = stripCommonPrefix(docs.map((doc) => normalizePath(doc.path)));
  return docs
    .map((doc, index) => ({ ...doc, path: paths[index] as string }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function ingest(source: IngestSource, ctx: IngestContext): Promise<IngestResult> {
  const notices: Notice[] = [];
  const outcomes: BuildOutcome[] = [];
  let ignored: IgnoredFile[] = [];
  let parsed: { docs: ParsedDoc[]; errors: ParseError[] };
  let originalPaths: string[];
  let scanned: number;
  let batchSource: BatchSource;
  let explicitLabel: string | undefined;

  if (source.kind === "files") {
    const filtered = filterFiles(source.collected.files);
    ignored = filtered.ignored;
    scanned = source.collected.scanned;
    batchSource = "upload";
    explicitLabel = source.label;
    if (source.collected.failures.length > 0) {
      notices.push(
        createNotice(
          "warning",
          `Could not read ${pluralize(source.collected.failures.length, "item")} in that folder.`,
          {
            details: listPaths(source.collected.failures)
          }
        )
      );
    }
    if (filtered.kept.length === 0) {
      notices.push(
        createNotice(
          "error",
          scanned > 0
            ? `No .json files found in that selection (${pluralize(scanned, "file")} scanned).`
            : "No .json files found in that selection."
        )
      );
      return { outcomes, notices, ignored, parseErrors: [] };
    }
    ctx.onProgress?.(`Reading ${pluralize(filtered.kept.length, "file")}…`);
    parsed = await readAndParse(filtered.kept, (done, total) => {
      ctx.onProgress?.(`Reading ${pluralize(total, "file")}…`, done / total);
    });
    originalPaths = filtered.kept.map((file) => file.path);
  } else {
    scanned = source.files.length;
    batchSource = source.source;
    explicitLabel = source.label;
    parsed = parseTexts(source.files);
    originalPaths = source.files.map((file) => file.path);
  }

  for (const error of parsed.errors) {
    notices.push(createNotice("error", `Couldn’t read ${error.path}: ${error.message}`));
  }
  const notSchema = parsed.docs.filter((doc) => !looksLikeSchemaDocument(doc.schema));
  if (notSchema.length > 0) {
    notices.push(
      createNotice(
        "info",
        `Ignored ${pluralize(notSchema.length, "JSON file")} that ${notSchema.length === 1 ? "is" : "are"} not a JSON Schema.`,
        { details: listPaths(notSchema.map((doc) => doc.path).sort()) }
      )
    );
  }
  const docs = relativize(parsed.docs.filter((doc) => looksLikeSchemaDocument(doc.schema)));
  if (docs.length === 0) {
    notices.push(
      createNotice(
        "error",
        `No JSON Schema found in ${pluralize(scanned, "file")}. Drop the schema folder, or files ending in .json.`
      )
    );
    return { outcomes, notices, ignored, parseErrors: parsed.errors };
  }

  const label = deriveGroupLabel(originalPaths, explicitLabel);
  const groups = splitIntoGroups(docs);
  const now = ctx.now ?? Date.now;
  const newBatchId = ctx.newBatchId ?? newId;
  const built: Dataset[] = [];
  for (const group of groups) {
    const groupDocs = relativize(group.docs);
    const groupLabel = groups.length > 1 ? group.label : label;
    const hash = hashDocs(groupDocs);
    const existing = ctx.existingBatches.find((batch) => batch.hash === hash);
    if (existing) {
      notices.push(
        createNotice(
          "info",
          `${groupLabel ?? "This selection"} is already loaded (as “${existing.label}”); skipped.`
        )
      );
      continue;
    }
    ctx.onProgress?.(`Building ${groupLabel ?? "the data dictionary"}…`);
    const outcome = await buildDatasets(
      { batchId: newBatchId(), label: groupLabel, source: batchSource, docs: groupDocs, createdAt: now() },
      {
        existing: [...ctx.existingDatasets, ...built],
        maxDatasets: ctx.maxDatasets,
        nextColor: ctx.nextColor,
        yield: ctx.yield
      }
    );
    built.push(...outcome.datasets);
    outcomes.push(outcome);
    notices.push(...outcome.notices);
  }
  return { outcomes, notices, ignored, parseErrors: parsed.errors };
}
