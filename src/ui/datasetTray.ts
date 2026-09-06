import type { AppActions } from "../app/actions";
import { describeIgnoreReason } from "../ingest/filter";
import { paletteSlot } from "../state/selectors";
import type { Store } from "../state/store";
import type { AppState, Dataset } from "../state/types";
import { formatCount, pluralize } from "../util/text";
import { confirmDialog } from "./dialog";
import { el, replaceChildren } from "./dom";
import { icon } from "./icons";
import type { Pickers } from "./pickers";

export function datasetColorAttrs(dataset: Pick<Dataset, "colorIndex">): Record<string, string> {
  const { slot, cycle } = paletteSlot(dataset.colorIndex);
  const attrs: Record<string, string> = { "data-ds": String(slot + 1) };
  if (cycle > 0) attrs["data-ds-cycle"] = String(cycle);
  return attrs;
}

export function cardDomId(datasetId: string): string {
  return `ds-${datasetId}`;
}

export interface TrayHandle {
  /** Where the semantic switch lives on narrow screens. */
  semanticSlot: HTMLElement;
  destroy(): void;
}

export function mountTray(
  container: HTMLElement,
  store: Store<AppState>,
  actions: AppActions,
  pickers: Pickers
): TrayHandle {
  const list = el("ul", { class: "se-tray__list" });
  const busy = el("div", { class: "se-tray__busy", hidden: true });
  const ignoredList = el("ul", null);
  const ignoredSummary = el("summary", null, "");
  const ignored = el("details", { class: "se-tray__ignored", hidden: true }, ignoredSummary, ignoredList);
  const semanticSlot = el("div", { class: "se-tray__semantic" });
  const nav = el(
    "nav",
    { class: "se-tray", "aria-label": "Loaded datasets", hidden: true },
    el(
      "div",
      { class: "se-container se-tray__row" },
      list,
      busy,
      el(
        "div",
        { class: "se-tray__actions" },
        el(
          "button",
          {
            type: "button",
            class: "se-btn se-btn--ghost se-btn--sm",
            "data-action": "pick-files",
            onclick: () => pickers.pickFiles()
          },
          icon("plus"),
          "Add files"
        ),
        el(
          "button",
          {
            type: "button",
            class: "se-btn se-btn--ghost se-btn--sm",
            "data-action": "pick-folder",
            onclick: () => pickers.pickFolder()
          },
          icon("folder"),
          "Add folder"
        ),
        el(
          "button",
          {
            type: "button",
            class: "se-btn se-btn--ghost se-btn--sm",
            "data-action": "load-examples",
            onclick: () => {
              void actions.loadExamples();
            }
          },
          icon("sparkles"),
          "Load examples"
        ),
        el(
          "button",
          {
            type: "button",
            class: "se-btn se-btn--ghost se-btn--sm se-btn--danger",
            "data-action": "clear-all",
            onclick: () => {
              const n = store.get().datasets.length;
              void confirmDialog({
                title: "Remove all datasets?",
                body: `This removes ${pluralize(n, "dataset")} from this browser. You can load them again from your files or the examples.`,
                confirmLabel: "Remove all",
                danger: true
              }).then((ok) => {
                if (ok) void actions.clearAll();
              });
            }
          },
          icon("trash"),
          "Clear all"
        ),
        ignored
      ),
      semanticSlot
    )
  );
  container.appendChild(nav);

  const renderChips = (datasets: readonly Dataset[]): void => {
    replaceChildren(
      list,
      datasets.map((dataset) =>
        el(
          "li",
          { class: "se-chip", ...datasetColorAttrs(dataset) },
          el(
            "a",
            {
              class: "se-chip__main",
              href: `#${cardDomId(dataset.id)}`,
              title: dataset.title ?? dataset.label,
              onclick: (event: Event) => {
                event.preventDefault();
                actions.focusDataset(dataset.id);
              }
            },
            el("span", { class: "se-swatch", "aria-hidden": "true" }),
            el("span", { class: "se-chip__label" }, dataset.label),
            el(
              "span",
              { class: "se-chip__count", "aria-label": pluralize(dataset.variableCount, "variable") },
              formatCount(dataset.variableCount)
            )
          ),
          el(
            "button",
            {
              type: "button",
              class: "se-chip__remove",
              "aria-label": `Remove ${dataset.label}`,
              title: `Remove ${dataset.label}`,
              onclick: () => {
                void actions.removeDataset(dataset.id);
              }
            },
            icon("close", 14)
          )
        )
      )
    );
  };

  const render = (state: AppState): void => {
    const visible = state.datasets.length > 0 || state.busy !== undefined;
    nav.hidden = !visible;
    if (!visible) return;
    if (state.busy) {
      const progress = state.busy.progress !== undefined ? ` ${Math.round(state.busy.progress * 100)}%` : "";
      replaceChildren(busy, icon("spinner"), ` ${state.busy.label}${progress}`);
      busy.hidden = false;
      busy.setAttribute("aria-busy", "true");
    } else {
      busy.hidden = true;
      busy.removeAttribute("aria-busy");
    }
    const ignoredFiles = state.ui.ignoredFiles;
    ignored.hidden = ignoredFiles.length === 0;
    if (ignoredFiles.length > 0) {
      ignoredSummary.textContent = pluralize(ignoredFiles.length, "file ignored", "files ignored");
      replaceChildren(
        ignoredList,
        ignoredFiles
          .slice(0, 50)
          .map((file) =>
            el("li", null, el("code", null, file.path), ` — ${describeIgnoreReason(file.reason)}`)
          ),
        ignoredFiles.length > 50 ? el("li", null, `… and ${ignoredFiles.length - 50} more`) : null
      );
    }
  };
  render(store.get());
  renderChips(store.get().datasets);
  const unsubscribeAll = store.subscribe(render);
  const unsubscribeChips = store.select((state) => state.datasets, renderChips);
  return {
    semanticSlot,
    destroy() {
      unsubscribeAll();
      unsubscribeChips();
      nav.remove();
    }
  };
}
