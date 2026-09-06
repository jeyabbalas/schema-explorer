// Turn a batch of schema documents into datasets: pick the table roots, flatten each one with
// the data-dictionary library, label, dedupe and colour the results.

import {
  findSchemaRoots,
  schemaDocumentsToTable,
  textKey,
  type DataDictionaryTable,
  type JsonSchema,
  type SchemaDocumentInput,
  type SchemaRootCandidate
} from "json-schema-data-dictionary";
import { createNotice } from "../state/notices";
import type { BatchSource, Dataset, LoadBatch, Notice, SchemaDoc } from "../state/types";
import { errorMessage, pluralize } from "../util/text";
import { hashDocs, hashTable, safeId } from "./hash";
import type { ParsedDoc } from "./parse";
import { fileStem, uniqueLabel } from "./paths";

/** Base of the synthetic retrieval URIs; relative `$ref`s resolve against `<base><batch>/<path>`. */
export const SYNTH_BASE = "https://schema-explorer.local/";
export const MAX_DATASETS = 16;

export function toSchemaInputs(
  batchId: string,
  docs: ReadonlyArray<{ path: string; name: string; schema: unknown }>
): SchemaDocumentInput[] {
  return docs.map((doc) => ({
    uri: `${SYNTH_BASE}${batchId}/${doc.path}`,
    name: doc.name,
    schema: doc.schema as JsonSchema
  }));
}

export type RootRule = "tables" | "unreferenced" | "top" | "none";

function byUri(a: SchemaRootCandidate, b: SchemaRootCandidate): number {
  return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
}

/**
 * Which documents become datasets: every table (an array-of-records schema nothing else
 * references); else every unreferenced schema with variables (plain object schemas); else the
 * best-ranked candidate; else nothing.
 */
export function chooseRoots(candidates: readonly SchemaRootCandidate[]): {
  roots: SchemaRootCandidate[];
  rule: RootRule;
} {
  const tables = candidates.filter((c) => c.arrayLike && !c.referenced);
  if (tables.length > 0) return { roots: [...tables].sort(byUri), rule: "tables" };
  const unreferenced = candidates.filter((c) => !c.referenced && c.variableCount > 0);
  if (unreferenced.length > 0) return { roots: [...unreferenced].sort(byUri), rule: "unreferenced" };
  const top = candidates[0];
  if (top) return { roots: [top], rule: "top" };
  return { roots: [], rule: "none" };
}

/**
 * A selection that spans several top-level directories, each with its own table root (a whole
 * multi-cohort folder), is split into one batch per directory. Anything else stays one batch:
 * a `schemas/` + `common/` layout, or a directory without a root of its own.
 */
export function splitIntoGroups(
  docs: readonly ParsedDoc[]
): Array<{ label: string | undefined; docs: ParsedDoc[] }> {
  const single = [{ label: undefined, docs: [...docs] }];
  const byDir = new Map<string, ParsedDoc[]>();
  for (const doc of docs) {
    const index = doc.path.indexOf("/");
    if (index < 0) return single;
    const dir = doc.path.slice(0, index);
    const group = byDir.get(dir) ?? [];
    group.push(doc);
    byDir.set(dir, group);
  }
  if (byDir.size < 2) return single;
  const groups: Array<{ label: string | undefined; docs: ParsedDoc[] }> = [];
  for (const [dir, group] of byDir) {
    const relative = group.map((doc) => ({ ...doc, path: doc.path.slice(dir.length + 1) }));
    const probe = relative.map((doc) => ({
      uri: `https://probe.local/${doc.path}`,
      name: doc.name,
      schema: doc.schema as JsonSchema
    }));
    if (!findSchemaRoots(probe).some((c) => c.arrayLike && !c.referenced)) return single;
    groups.push({ label: dir, docs: relative });
  }
  return groups;
}

/** "BGS" for a single root; "OFH · questionnaire" when a batch holds several tables. */
export function defaultLabel(groupLabel: string | undefined, rootPath: string, rootCount: number): string {
  const stem = fileStem(rootPath);
  if (rootCount === 1) return groupLabel ?? stem;
  return groupLabel ? `${groupLabel} · ${stem}` : stem;
}

export interface BuildInput {
  batchId: string;
  /** Group label (dropped folder, example set); undefined falls back to the root file's name. */
  label: string | undefined;
  source: BatchSource;
  /** Schema-like documents with paths relative to the batch. */
  docs: ParsedDoc[];
  createdAt: number;
}

export interface BuildContext {
  /** Datasets already loaded (dedupe, labels, the dataset cap). */
  existing: readonly Dataset[];
  maxDatasets: number;
  nextColor: () => number;
  /** Called between roots so the page can paint. */
  yield?: (() => Promise<void>) | undefined;
}

export interface BuildOutcome {
  /** Undefined when the batch produced no dataset. */
  batch: LoadBatch | undefined;
  datasets: Dataset[];
  notices: Notice[];
}

export async function buildDatasets(input: BuildInput, ctx: BuildContext): Promise<BuildOutcome> {
  const notices: Notice[] = [];
  const datasets: Dataset[] = [];
  const where = input.label ?? "the selection";
  const none = (): BuildOutcome => ({ batch: undefined, datasets, notices });

  if (input.docs.length === 0) {
    notices.push(createNotice("error", `No JSON Schema found in ${where}.`));
    return none();
  }
  const inputs = toSchemaInputs(input.batchId, input.docs);
  let candidates: SchemaRootCandidate[];
  try {
    candidates = findSchemaRoots(inputs);
  } catch (err) {
    notices.push(createNotice("error", `Could not read the schemas in ${where}: ${errorMessage(err)}`));
    return none();
  }
  const { roots, rule } = chooseRoots(candidates);
  if (rule === "none") {
    notices.push(createNotice("error", `No JSON Schema found in ${where}.`));
    return none();
  }
  if (rule === "unreferenced" && roots.length > 1) {
    notices.push(
      createNotice(
        "info",
        `${where}: no table schema (type: array) found, so each object schema was loaded as its own dataset. Include the root schema to get one dataset with categories.`
      )
    );
  }

  const base = `${SYNTH_BASE}${input.batchId}/`;
  const taken = new Set(ctx.existing.map((dataset) => dataset.label));
  for (const root of roots) {
    const rootPath = root.uri.startsWith(base) ? root.uri.slice(base.length) : (root.name ?? root.uri);
    if (ctx.existing.length + datasets.length >= ctx.maxDatasets) {
      notices.push(
        createNotice(
          "warning",
          `Dataset limit (${ctx.maxDatasets}) reached; skipped ${rootPath}. Remove a dataset to add more.`
        )
      );
      break;
    }
    let table: DataDictionaryTable;
    try {
      table = schemaDocumentsToTable(inputs, { rootUri: root.uri, splitAllOfObjectCategories: true });
    } catch (err) {
      notices.push(
        createNotice("error", `Could not build a data dictionary from ${rootPath}: ${errorMessage(err)}`)
      );
      continue;
    }
    if (table.rows.length === 0) {
      notices.push(createNotice("info", `${rootPath} describes no variables; skipped.`));
      continue;
    }
    const contentHash = hashTable(table);
    const label = uniqueLabel(defaultLabel(input.label, rootPath, roots.length), taken);
    const duplicate = [...ctx.existing, ...datasets].find((dataset) => dataset.contentHash === contentHash);
    if (duplicate) {
      notices.push(
        createNotice(
          "info",
          `${label} is already loaded as “${duplicate.label}” (identical content); skipped.`
        )
      );
      continue;
    }
    taken.add(label);
    const dataset: Dataset = {
      id: safeId(textKey(`${input.batchId}|${root.uri}`)),
      batchId: input.batchId,
      rootUri: root.uri,
      rootPath,
      label,
      title: table.title ?? root.title,
      colorIndex: ctx.nextColor(),
      table,
      variableCount: table.rows.length,
      categoryCount: table.categories.length,
      warnings: table.warnings,
      contentHash,
      createdAt: input.createdAt
    };
    datasets.push(dataset);
    if (table.warnings.length > 0) {
      notices.push(
        createNotice(
          "warning",
          `${label}: ${pluralize(table.warnings.length, "warning")} while reading the schema.`,
          {
            details: table.warnings,
            datasetId: dataset.id
          }
        )
      );
    }
    await ctx.yield?.();
  }

  if (datasets.length === 0) return none();
  const docs: SchemaDoc[] = input.docs
    .map((doc) => ({
      path: doc.path,
      name: doc.name,
      uri: `${base}${doc.path}`,
      text: doc.text,
      schema: doc.schema as JsonSchema,
      bytes: doc.bytes
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const first = datasets[0] as Dataset;
  const batch: LoadBatch = {
    id: input.batchId,
    label: input.label ?? (roots.length === 1 ? fileStem(first.rootPath) : "Files"),
    source: input.source,
    createdAt: input.createdAt,
    docs,
    hash: hashDocs(docs),
    roots
  };
  return { batch, datasets, notices };
}
