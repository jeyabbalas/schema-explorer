// The cross-dataset results: an availability strip (one cell per dataset) and the matching
// rows grouped per dataset, in dataset order.

import type { AppActions } from "../app/actions";
import { PER_DATASET_EXACT, PER_DATASET_RELATED } from "../search/constants";
import { availabilitySummary, type DatasetAvailability } from "../search/summary";
import type { CatalogSearchResult, DatasetHits } from "../search/types";
import type { Store } from "../state/store";
import type { AppState, Dataset } from "../state/types";
import { formatCount, pluralize } from "../util/text";
import { cardDomId, datasetColorAttrs } from "./datasetTray";
import { el, prefersReducedMotion, replaceChildren } from "./dom";
import { icon } from "./icons";
import { renderResultRow } from "./resultRow";

export function groupDomId(datasetId: string): string {
  return `rg-${datasetId}`;
}

function countsText(cell: DatasetAvailability): string {
  if (cell.status === "none") return "no match";
  const parts: string[] = [];
  if (cell.exactCount > 0) parts.push(`${formatCount(cell.exactCount)} exact`);
  if (cell.relatedCount > 0) parts.push(`${formatCount(cell.relatedCount)} related`);
  return parts.join(" · ");
}

export function mountResults(
  container: HTMLElement,
  store: Store<AppState>,
  actions: AppActions
): () => void {
  const title = el("h2", { class: "se-results__title", id: "se-results-title" });
  const exportButton = el(
    "button",
    {
      type: "button",
      class: "se-btn se-btn--ghost se-btn--sm",
      "data-action": "export-results",
      onclick: () => actions.exportResultsCsv()
    },
    icon("download"),
    "Export CSV"
  );
  const strip = el("ul", { class: "se-strip" });
  const groups = el("div", { class: "se-groups" });
  const none = el("p", { class: "se-results__none", hidden: true });
  const empty = el("div", { class: "se-results__empty", hidden: true });
  const section = el(
    "section",
    {
      class: "se-results",
      id: "se-results",
      "aria-labelledby": "se-results-title",
      tabindex: "-1",
      hidden: true
    },
    el(
      "div",
      { class: "se-container" },
      el("div", { class: "se-results__head" }, title, exportButton),
      strip,
      groups,
      none,
      empty
    )
  );
  container.appendChild(section);

  // Per-dataset "Show all" state, reset whenever the query changes.
  const expanded = new Set<string>();
  let lastQuery = "";

  const scrollToGroup = (datasetId: string): void => {
    const group = document.getElementById(groupDomId(datasetId));
    if (!group) return;
    group.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    group.focus({ preventScroll: true });
  };

  const renderStrip = (summary: DatasetAvailability[], query: string): void => {
    strip.setAttribute("aria-label", `Datasets containing “${query}”`);
    replaceChildren(
      strip,
      summary.map((cell) => {
        const inner = [
          cell.status === "none" ? null : el("span", { class: "se-swatch", "aria-hidden": "true" }),
          el("span", { class: "se-strip__label" }, cell.label),
          el("span", { class: "se-strip__counts" }, countsText(cell))
        ];
        const attrs = { class: "se-strip__cell", "data-state": cell.status, ...datasetColorAttrs(cell) };
        const node =
          cell.status === "none"
            ? el("span", attrs, ...inner)
            : el(
                "a",
                {
                  ...attrs,
                  href: `#${groupDomId(cell.datasetId)}`,
                  "aria-label": `${cell.label}: ${countsText(cell)}. Go to ${cell.label} results`,
                  onclick: (event: Event) => {
                    event.preventDefault();
                    scrollToGroup(cell.datasetId);
                  }
                },
                ...inner
              );
        return el("li", null, node);
      })
    );
  };

  const renderGroup = (group: DatasetHits, dataset: Dataset, result: CatalogSearchResult): HTMLElement => {
    const total = group.exact.length + group.related.length;
    const isExpanded = expanded.has(dataset.id);
    const shownExact = isExpanded ? group.exact : group.exact.slice(0, PER_DATASET_EXACT);
    const shownRelated = isExpanded ? group.related : group.related.slice(0, PER_DATASET_RELATED);
    const hiddenCount = total - shownExact.length - shownRelated.length;
    const terms = result.terms.length > 0 ? result.terms : [result.normalizedQuery];

    const tbody = el("tbody", null);
    for (const hit of shownExact) tbody.appendChild(renderResultRow(hit, dataset, terms, actions));
    if (shownRelated.length > 0) {
      tbody.appendChild(
        el("tr", { class: "se-row se-row--divider" }, el("td", { colspan: "5" }, "Related by meaning"))
      );
      for (const hit of shownRelated) tbody.appendChild(renderResultRow(hit, dataset, terms, actions));
    }
    const countLabel =
      group.exact.length === 0
        ? `${formatCount(group.related.length)} related`
        : group.related.length > 0
          ? `${pluralize(group.exact.length, "match", "matches")} · ${formatCount(group.related.length)} related`
          : pluralize(group.exact.length, "match", "matches");
    const foot =
      hiddenCount > 0 || isExpanded
        ? el(
            "div",
            { class: "se-group__foot" },
            el(
              "button",
              {
                type: "button",
                class: "se-btn se-btn--ghost se-btn--sm",
                "aria-expanded": String(isExpanded),
                onclick: () => {
                  if (isExpanded) expanded.delete(dataset.id);
                  else expanded.add(dataset.id);
                  render(store.get());
                }
              },
              isExpanded ? "Show fewer" : `Show all ${formatCount(total)}`
            )
          )
        : null;
    return el(
      "section",
      {
        class: "se-group",
        id: groupDomId(dataset.id),
        "aria-labelledby": `${groupDomId(dataset.id)}-title`,
        tabindex: "-1",
        ...datasetColorAttrs(dataset)
      },
      el(
        "header",
        { class: "se-group__head" },
        el("span", { class: "se-swatch", "aria-hidden": "true" }),
        el(
          "h3",
          { class: "se-group__title", id: `${groupDomId(dataset.id)}-title` },
          el(
            "a",
            {
              href: `#${cardDomId(dataset.id)}`,
              onclick: (event: Event) => {
                event.preventDefault();
                actions.focusDataset(dataset.id);
              }
            },
            dataset.label
          )
        ),
        el("span", { class: "se-group__count" }, countLabel)
      ),
      el(
        "div",
        { class: "se-table-wrap" },
        el(
          "table",
          { class: "se-table" },
          el("caption", { class: "se-visually-hidden" }, `Matches in ${dataset.label}`),
          el(
            "colgroup",
            null,
            el("col", { class: "se-c-var" }),
            el("col", { class: "se-c-desc" }),
            el("col", { class: "se-c-type" }),
            el("col", { class: "se-c-vals" }),
            el("col", { class: "se-c-cons" })
          ),
          el(
            "thead",
            null,
            el(
              "tr",
              null,
              el("th", { scope: "col" }, "Variable"),
              el("th", { scope: "col" }, "Description"),
              el("th", { scope: "col" }, "Type"),
              el("th", { scope: "col" }, "Valid values"),
              el("th", { scope: "col" }, "Constraints")
            )
          ),
          tbody
        )
      ),
      foot
    );
  };

  const render = (state: AppState): void => {
    const query = state.search.query.trim();
    const result = state.search.result;
    const active = query.length > 0 && state.datasets.length > 0 && result !== undefined;
    section.hidden = !active;
    if (!active || !result) return;
    if (result.normalizedQuery !== lastQuery) {
      expanded.clear();
      lastQuery = result.normalizedQuery;
    }
    const datasets = new Map(state.datasets.map((dataset) => [dataset.id, dataset]));
    const summary = availabilitySummary(result, state.datasets);
    title.textContent = `Availability of “${query}”`;
    const totalHits = result.totalExact + result.totalRelated;
    exportButton.disabled = totalHits === 0;
    renderStrip(summary, query);

    replaceChildren(
      groups,
      result.perDataset
        .filter((group) => group.exact.length + group.related.length > 0)
        .map((group) => {
          const dataset = datasets.get(group.datasetId);
          return dataset ? renderGroup(group, dataset, result) : null;
        })
    );

    const missing = summary.filter((cell) => cell.status === "none").map((cell) => cell.label);
    none.hidden = !(totalHits > 0 && missing.length > 0);
    if (!none.hidden) none.textContent = `Not found in: ${missing.join(", ")}`;

    empty.hidden = totalHits > 0;
    if (totalHits === 0) {
      const hint =
        result.semantic.state === "pending" || result.semantic.state === "partial"
          ? "Looking for related variables by meaning…"
          : state.semantic.kind === "off"
            ? "Try different words, or turn on Semantic search to find related variables."
            : "Try different words.";
      replaceChildren(
        empty,
        el(
          "p",
          null,
          `No variables match “${query}” in any of ${pluralize(state.datasets.length, "dataset")}.`
        ),
        el("p", { class: "se-muted" }, hint)
      );
    }
  };

  render(store.get());
  const unsubscribe = store.subscribe((state, prev) => {
    if (
      state.search !== prev.search ||
      state.datasets !== prev.datasets ||
      state.semantic !== prev.semantic
    ) {
      render(state);
    }
  });
  return () => {
    unsubscribe();
    section.remove();
  };
}
