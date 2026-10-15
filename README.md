# Schema Explorer

Explore and search several JSON Schema data dictionaries at once, entirely in your browser.

Load the JSON Schemas that describe your tabular datasets (one root schema per table), browse each one as a
data dictionary, and search across all of them to check where a variable concept is available. Built for
designing studies that pool cohorts: type "smoking status" once and see which cohorts have it.

**Live:** https://jeyabbalas.github.io/schema-explorer/

Built with [json-schema-data-dictionary](https://github.com/jeyabbalas/json-schema-to-data-dictionary), which
renders a JSON Schema for an array of records as a flat, searchable data dictionary.

## Features

- **Several dictionaries side by side.** Each loaded table becomes a colour-coded card with its own data
  dictionary and search box: categories, valid values, special codes, constraints, the schema author's
  `$comment` notes, and skip patterns you can follow from either end. The table scrolls under a sticky
  column header, columns resize (the widths are remembered per dataset), and **Excel** downloads a
  formatted workbook with _Data dictionary_, _Skip logic_ and _About_ sheets (_Copy_ copies CSV).
- **One search across every dataset.** The availability strip answers "which datasets have this concept?"
  at a glance; matches are grouped per dataset with highlighted terms, notes, and the skip patterns
  that set each code, and any row can be opened in its dictionary. Export the results as CSV.
- **Keyword + semantic search.** Keyword search (BM25F) is instant. An opt-in switch adds semantic search:
  variables that are related by meaning appear as "related" rows with a similarity score. Three on-device
  embedding models are offered: a small default that runs everywhere, and EmbeddingGemma 2 and Jina v5
  nano for better results (WebGPU only).
- **Load schemas however you keep them.** Drop files or a whole folder (relative `$ref`s resolve by path),
  use the file or folder picker, or load the bundled example datasets with one click.
- **Everything stays in your browser.** Schemas are parsed on your device and kept in IndexedDB so a reload
  restores them. Nothing is uploaded anywhere.

## Using it

1. Open the site and **drop your schema files or a folder** onto the page, or use _Choose files_ /
   _Choose folder_. When schemas reference each other with relative `$ref`s (for example
   `categories/x.json` or `../../common/defs.json`), drop or choose the **folder** so the paths resolve.
   Every array-of-records schema that nothing else references becomes a dataset; a folder with several
   tables yields several datasets. Non-schema JSON, hidden files and non-JSON files are ignored and listed.
2. Or click **Load the example datasets** to load the four bundled sets described below.
3. **Search** in the box at the top (`/` focuses it, `Esc` clears it). The strip under the search shows one
   cell per dataset; groups below list the matching variables. _Open in dictionary_ (the arrow next to a
   variable name) scrolls to the dataset's card and filters its dictionary to that variable.
4. Turn on **Semantic search** to also find variables that are related by meaning. The first time, the
   model is downloaded from Hugging Face and cached by the browser; indexing the loaded datasets takes a
   few seconds on WebGPU (longer on WASM). Keyword search keeps working meanwhile. The picker next to the
   switch chooses the embedding model (see below); changing it re-indexes the loaded datasets.
5. Rename a dataset (pencil), collapse it, remove it (undo from the toast), or **Clear all** to start over.

## Privacy

Your schemas never leave your browser: they are parsed locally and stored only in this browser's IndexedDB
until you remove them. The only network requests the app makes are for its own files, the bundled examples,
and, when semantic search is switched on, Transformers.js from jsDelivr and the embedding model from
huggingface.co.

## Semantic search notes

All three models run in the browser with Transformers.js 4.3.1 (ONNX Runtime); the picker next to the
switch chooses between them and the choice is remembered.

| Model                                                                                                                                | Params | Download     | Licence                                    | Runs on        | Notes                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------ | ------------------------------------------ | -------------- | ----------------------------------------------------------------------------------- |
| [MongoDB/mdbr-leaf-ir](https://huggingface.co/MongoDB/mdbr-leaf-ir) (LEAF-IR, default)                                               | 23M    | 23–46 MB     | Apache-2.0                                 | WebGPU or WASM | Small and quick to index; good results.                                             |
| [onnx-community/embeddinggemma-2-ONNX](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX) (EmbeddingGemma 2)               | 270M   | 190 MB q4f16 | Apache-2.0                                 | WebGPU only    | Strong retrieval in 100+ languages; the text model alone (no vision/audio weights). |
| [jinaai/jina-embeddings-v5-text-nano-retrieval](https://huggingface.co/jinaai/jina-embeddings-v5-text-nano-retrieval) (Jina v5 nano) | 239M   | 124 MB q4f16 | **CC BY-NC 4.0** (non-commercial use only) | WebGPU only    | Highest retrieval quality (best MRR in the library's evaluation); slower to index.  |

- WebGPU is used when the browser exposes it (Chrome/Edge 113+, Safari 26, Firefox on Windows); otherwise
  LEAF-IR runs on single-threaded WASM, which is slower to index but works everywhere. EmbeddingGemma 2
  and Jina v5 nano are far too large for WASM, so the picker disables them in browsers without WebGPU, and
  a saved preference for either falls back to LEAF-IR there (with a notice).
- On the library's labelled query set, hybrid ranking reaches MRR 0.90 with LEAF-IR, 0.92 with
  EmbeddingGemma 2 and 0.94 with Jina v5 nano (0.82 for keyword search alone).
- Jina v5 nano's weights are licensed for **non-commercial use only**; pick it only when that applies to you.
  EmbeddingGemma 2 is Apache-2.0.
- The model weights are cached by the browser (Cache API) and the row vectors in IndexedDB, one vector cache
  per model, so later visits and switching back and forth are fast. **Before a live demo, open the site once
  on the demo machine, load your datasets, switch semantic search on and pick the model you will present
  with** so its weights and vectors are already cached.
- The switch and the model are remembered; semantic search starts automatically on later visits.

## Example datasets

| Set    | Study                                             | Tables                                                       |
| ------ | ------------------------------------------------- | ------------------------------------------------------------ |
| BGS    | Breast Cancer Now Generations Study               | derived variables (60 variables, 12 categories)              |
| MWS    | Million Women Study                               | recruitment variables (38 variables, 7 categories)           |
| OFH    | Our Future Health                                 | participant (14 variables) and questionnaire (359 variables) |
| TARGET | CD3 harmonised target schema (baseline lifestyle) | 5 variables that cohort schemas map onto                     |

The bundled example datasets are the schema sets of the
[CD3 schemify pilot](https://github.com/mgarciaclosas/cd3-schemify-pilot), Copyright (c) 2026 mgarciaclosas,
MIT License; the license text is redistributed at `public/examples/LICENSE`. Regenerate the copies from a
checkout of that repository with `npm run sync-examples` (`CD3_SOURCE=/path/to/checkout` overrides the
default sibling-directory location).

A self-hosted build can ship its own example sets instead. Replace the contents of `public/examples/` with
your schema files and a `manifest.json` in the format defined in `src/examples/manifest.ts`: its
`description` is the line under the **Load the example datasets** button, and the footer credits its
`source`. Without a `public/examples/manifest.json`, the app hides the examples buttons.

## Development

Requires Node 22.18 or later.

```sh
npm install
npm run dev          # http://localhost:5173/schema-explorer/
npm run check        # typecheck, lint, format check, tests, production build
npm run test:watch   # tests in watch mode
npm run preview      # serve the production build at http://localhost:4173/schema-explorer/
npm run sync-examples
```

Vanilla TypeScript with Vite; no UI framework. `src/ingest` turns files into datasets, `src/search` holds
the merged cross-dataset catalog, the search engine wrapper and the semantic controller (the embedding
model runs in `src/search/embed.worker.ts`), `src/persist` is the IndexedDB layer, `src/ui` the views and
`src/app/actions.ts` the orchestration. Tests run on Vitest with happy-dom and fake-indexeddb; semantic
search is tested with a deterministic fake embedder, so nothing is downloaded in CI.

Dev/test overrides for the embedding worker via the page URL: `?device=wasm`, `?dtype=q8`, `?nogpu=1`.

## Deployment

Every push to `main` runs the quality gate and deploys `dist/` to GitHub Pages through the workflow in
`.github/workflows/deploy-pages.yml`; pull requests run the gate only. One-time setup for a fork: enable
Pages with the GitHub Actions source (`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`,
or Settings → Pages → Source = GitHub Actions). The app is built for the `/schema-explorer/` path; set
`BASE_PATH=/` when building for a root host. GitHub Pages caches files for 10 minutes, so a page loaded
just before a deploy may need a hard reload.

## License

MIT © 2026 Jeya Balaji Balasubramanian. See [LICENSE](LICENSE).

Acknowledgements: [json-schema-data-dictionary](https://github.com/jeyabbalas/json-schema-to-data-dictionary),
[Transformers.js](https://github.com/huggingface/transformers.js) and the
[CD3 schemify pilot](https://github.com/mgarciaclosas/cd3-schemify-pilot).
