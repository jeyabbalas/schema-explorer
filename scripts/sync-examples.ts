// Copies the CD3 schemify pilot schema sets into public/examples/ and regenerates manifest.json.
//
//   npm run sync-examples                         # source: ../cd3-schemify-pilot-main
//   CD3_SOURCE=/path/to/checkout npm run sync-examples
//
// Only the allow-listed schema files are copied, byte for byte, so relative $refs keep working
// and the copies stay diffable against upstream. After copying, every group is run through the
// data-dictionary library: the script fails if a table root is missing or a $ref does not resolve.
// The script is idempotent: a second run against the same source produces no git diff.

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findSchemaRoots,
  schemaDocumentsToTable,
  type SchemaDocumentInput
} from "json-schema-data-dictionary";
import {
  MANIFEST_VERSION,
  type ExampleDataset,
  type ExampleFile,
  type ExampleGroup,
  type ExampleManifest
} from "../src/examples/manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(process.env.CD3_SOURCE ?? join(ROOT, "..", "cd3-schemify-pilot-main"));
const DEST = join(ROOT, "public", "examples");

interface GroupSpec {
  id: string;
  label: string;
  name: string;
  description: string;
  sourceDir: string;
  /** Literal file paths, or `dir/*.json` for every JSON file directly inside `dir`. */
  files: string[];
}

const GROUPS: GroupSpec[] = [
  {
    id: "bgs",
    label: "BGS",
    name: "Breast Cancer Now Generations Study — derived variables",
    description:
      "60 analysis-ready derived variables at baseline in 12 categories, with shared missing-value codes.",
    sourceDir: "BGS/json_schema",
    files: [
      "derived_variables/derived_variables.schema.json",
      "derived_variables/categories/*.json",
      "common/defs.json"
    ]
  },
  {
    id: "mws",
    label: "MWS",
    name: "Million Women Study — recruitment variables",
    description: "38 recruitment-questionnaire variables in 7 categories.",
    sourceDir: "MWS/json_schema",
    files: ["recruitment/recruitment.schema.json", "recruitment/categories/*.json", "common/defs.json"]
  },
  {
    id: "ofh",
    label: "OFH",
    name: "Our Future Health — participant and questionnaire",
    description:
      "One folder, two tables: 14 participant registration fields and a 359-variable questionnaire in 6 sections.",
    sourceDir: "OFH/json_schema",
    files: [
      "participant/participant.schema.json",
      "participant/categories/participant.json",
      "questionnaire/questionnaire.schema.json",
      "questionnaire/categories/*.json",
      "common/defs.json"
    ]
  },
  {
    id: "target",
    label: "TARGET",
    name: "CD3 target schema — baseline lifestyle",
    description:
      "A 5-variable harmonised target table (age, smoking and alcohol status) that cohort schemas map onto.",
    sourceDir: "TARGET",
    files: ["target_baseline_lifestyle.schema.json"]
  }
];

function fail(message: string): never {
  console.error(`sync-examples: ${message}`);
  process.exit(1);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Expand the allow-list of one group into concrete relative paths (sorted, no dotfiles). */
function expand(spec: GroupSpec): string[] {
  const base = join(SOURCE, spec.sourceDir);
  if (!isDirectory(base)) fail(`source directory not found: ${base}`);
  const out: string[] = [];
  for (const pattern of spec.files) {
    if (pattern.endsWith("/*.json")) {
      const dir = pattern.slice(0, -"/*.json".length);
      if (!isDirectory(join(base, dir))) fail(`directory not found: ${join(base, dir)}`);
      const matches = readdirSync(join(base, dir))
        .filter((name) => /\.json$/i.test(name) && !name.startsWith("."))
        .sort()
        .map((name) => `${dir}/${name}`);
      if (matches.length === 0) fail(`no JSON files match ${pattern} in ${base}`);
      out.push(...matches);
    } else {
      try {
        statSync(join(base, pattern));
      } catch {
        fail(`file not found: ${join(base, pattern)}`);
      }
      out.push(pattern);
    }
  }
  return out;
}

/** Copy one group and return its manifest entry. */
function syncGroup(spec: GroupSpec): ExampleGroup {
  const base = join(SOURCE, spec.sourceDir);
  const dest = join(DEST, spec.id);
  const paths = expand(spec);

  rmSync(dest, { recursive: true, force: true });
  const files: ExampleFile[] = [];
  const docs: SchemaDocumentInput[] = [];
  for (const path of paths) {
    const src = join(base, path);
    const bytes = readFileSync(src);
    let schema: unknown;
    try {
      schema = JSON.parse(bytes.toString("utf8"));
    } catch (err) {
      fail(`${src} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const target = join(dest, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    files.push({ path, bytes: bytes.length });
    docs.push({
      uri: `https://examples.local/${spec.id}/${path}`,
      name: basename(path),
      schema: schema as SchemaDocumentInput["schema"]
    });
  }

  const roots = findSchemaRoots(docs)
    .filter((candidate) => candidate.arrayLike && !candidate.referenced)
    .sort((a, b) => a.uri.localeCompare(b.uri));
  if (roots.length === 0)
    fail(`${spec.id}: no table root (type: array schema that nothing references) found`);

  const datasets: ExampleDataset[] = roots.map((root) => {
    const table = schemaDocumentsToTable(docs, { rootUri: root.uri, splitAllOfObjectCategories: true });
    const unresolved = table.warnings.filter((warning) => /could not resolve/i.test(warning));
    if (unresolved.length > 0) fail(`${spec.id}: ${unresolved.join("\n")}`);
    if (table.rows.length === 0) fail(`${spec.id}: ${root.uri} describes no variables`);
    return {
      root: root.uri.slice(`https://examples.local/${spec.id}/`.length),
      title: table.title ?? root.title ?? basename(root.uri),
      variables: table.rows.length,
      categories: table.categories.length
    };
  });

  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  console.log(
    `${spec.id}: ${files.length} files, ${total.toLocaleString("en-US")} B, ${datasets.length} table${datasets.length === 1 ? "" : "s"} (${datasets
      .map((d) => `${d.variables} variables, ${d.categories} categories`)
      .join("; ")})`
  );
  return {
    id: spec.id,
    label: spec.label,
    name: spec.name,
    description: spec.description,
    sourcePath: spec.sourceDir,
    bytes: total,
    files,
    datasets
  };
}

function main(): void {
  if (!isDirectory(SOURCE)) fail(`source checkout not found at ${SOURCE} (set CD3_SOURCE)`);
  const license = join(SOURCE, "LICENSE");
  try {
    statSync(license);
  } catch {
    fail(`LICENSE not found in ${SOURCE}`);
  }
  mkdirSync(DEST, { recursive: true });
  const groups = GROUPS.map(syncGroup);
  cpSync(license, join(DEST, "LICENSE"));

  const manifest: ExampleManifest = {
    $comment: "Generated by scripts/sync-examples.ts — do not edit. Regenerate with `npm run sync-examples`.",
    version: MANIFEST_VERSION,
    source: {
      name: "CD3 schemify pilot",
      url: "https://github.com/mgarciaclosas/cd3-schemify-pilot",
      license: "MIT",
      copyright: "Copyright (c) 2026 mgarciaclosas",
      licenseFile: "LICENSE"
    },
    groups
  };
  writeFileSync(join(DEST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const total = groups.reduce((sum, group) => sum + group.bytes, 0);
  console.log(
    `wrote ${join(DEST, "manifest.json")} (${groups.length} groups, ${total.toLocaleString("en-US")} B)`
  );
}

main();
