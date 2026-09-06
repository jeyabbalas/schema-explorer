import { renderDataDictionary, type DataDictionaryElement } from "json-schema-data-dictionary";
import type { AppActions } from "../app/actions";
import type { Dataset } from "../state/types";
import { pluralize } from "../util/text";
import { cardDomId, datasetColorAttrs } from "./datasetTray";
import { el, prefersReducedMotion, replaceChildren } from "./dom";
import { icon } from "./icons";
import type { ResolvedTheme } from "./theme";

export interface CardOptions {
  theme: ResolvedTheme;
  collapsed: boolean;
}

export interface CardHandle {
  readonly root: HTMLElement;
  readonly id: string;
  update(dataset: Dataset, collapsed: boolean): void;
  /** Drive the embedded dictionary's own search box to show one variable; returns false when impossible. */
  showVariable(name: string): boolean;
  clearFilter(): void;
  flash(): void;
  destroy(): void;
}

export function createCard(dataset: Dataset, actions: AppActions, options: CardOptions): CardHandle {
  const id = dataset.id;
  const label = el("h2", { class: "se-card__label", id: `${cardDomId(id)}-label` }, dataset.label);
  const meta = el("p", { class: "se-card__meta" });
  const warnBadge = el("button", {
    type: "button",
    class: "se-badge se-badge--warn",
    "aria-expanded": "false",
    "aria-controls": `${cardDomId(id)}-warnings`,
    hidden: true
  });
  const warnList = el("ul", { class: "se-card__warnlist", id: `${cardDomId(id)}-warnings`, hidden: true });
  const filterName = el("code", null);
  const filter = el(
    "p",
    { class: "se-card__filter", hidden: true },
    "Filtered to ",
    filterName,
    " · ",
    el(
      "button",
      {
        type: "button",
        class: "se-btn se-btn--link",
        "data-action": "unfilter",
        onclick: () => {
          handle.clearFilter();
        }
      },
      "Show all variables"
    )
  );
  const body = el("div", { class: "se-card__body", id: `${cardDomId(id)}-body` });
  const collapseButton = el("button", {
    type: "button",
    class: "se-iconbtn",
    "data-action": "collapse",
    "aria-controls": body.id
  });
  const renameButton = el(
    "button",
    { type: "button", class: "se-iconbtn", "data-action": "rename" },
    icon("pencil")
  );
  const removeButton = el(
    "button",
    { type: "button", class: "se-iconbtn", "data-action": "remove" },
    icon("close")
  );
  const head = el(
    "header",
    { class: "se-card__head" },
    el("span", { class: "se-swatch se-swatch--lg", "aria-hidden": "true" }),
    label,
    meta,
    warnBadge,
    el("div", { class: "se-card__actions" }, renameButton, collapseButton, removeButton)
  );
  const root = el(
    "article",
    {
      class: "se-card",
      id: cardDomId(id),
      "aria-labelledby": label.id,
      tabindex: "-1",
      ...datasetColorAttrs(dataset)
    },
    head,
    warnList,
    filter,
    body
  );

  let current = dataset;
  let collapsed = options.collapsed;
  let element: DataDictionaryElement | undefined;

  const mountDictionary = (): void => {
    element = renderDataDictionary(body, current.table, {
      theme: options.theme,
      // Small or single-section dictionaries open expanded; larger ones start as a table of
      // contents (the component's own "Expand all" is one click away).
      expandCategories: current.categoryCount <= 1 || current.variableCount <= 20,
      searchPlaceholder: `Search within ${current.label}…`,
      includeExport: true,
      pageSize: 100,
      resultsPageSize: 50
    });
  };

  const searchBox = (): HTMLInputElement | undefined => {
    const box = element?.shadowRoot?.querySelector<HTMLInputElement>("[data-dd-search]");
    return box ?? undefined;
  };

  const renderHead = (): void => {
    label.textContent = current.label;
    replaceChildren(
      meta,
      `${pluralize(current.variableCount, "variable")} · ${pluralize(current.categoryCount, "category", "categories")}`,
      current.source === "example" ? [" · ", el("span", { class: "se-card__source" }, "Example")] : null
    );
    const n = current.warnings.length;
    warnBadge.hidden = n === 0;
    replaceChildren(warnBadge, icon("warning", 14), ` ${pluralize(n, "warning")}`);
    replaceChildren(
      warnList,
      current.warnings.map((warning) => el("li", null, warning))
    );
    renameButton.setAttribute("aria-label", `Rename ${current.label}`);
    renameButton.title = `Rename ${current.label}`;
    removeButton.setAttribute("aria-label", `Remove ${current.label}`);
    removeButton.title = `Remove ${current.label}`;
    collapseButton.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${current.label}`);
    collapseButton.title = collapseButton.getAttribute("aria-label") ?? "";
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
    replaceChildren(collapseButton, icon("chevron-down"));
    root.dataset.collapsed = String(collapsed);
    const colors = datasetColorAttrs(current);
    root.setAttribute("data-ds", colors["data-ds"] ?? "1");
    if (colors["data-ds-cycle"]) root.setAttribute("data-ds-cycle", colors["data-ds-cycle"]);
    else root.removeAttribute("data-ds-cycle");
  };

  warnBadge.addEventListener("click", () => {
    const open = warnList.hidden;
    warnList.hidden = !open;
    warnBadge.setAttribute("aria-expanded", String(open));
  });
  collapseButton.addEventListener("click", () => {
    actions.setCardCollapsed(id, !collapsed);
  });
  removeButton.addEventListener("click", () => {
    void actions.removeDataset(id);
  });

  const startRename = (): void => {
    const input = el("input", {
      type: "text",
      class: "se-card__rename",
      value: current.label,
      "aria-label": "Dataset name",
      maxlength: "80"
    });
    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      input.replaceWith(label);
      if (commit && value && value !== current.label) actions.renameDataset(id, value);
      renameButton.focus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    label.replaceWith(input);
    input.focus();
    input.select();
  };
  renameButton.addEventListener("click", startRename);
  label.addEventListener("dblclick", startRename);

  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const handle: CardHandle = {
    root,
    id,
    update(next, nextCollapsed) {
      const tableChanged = next.table !== current.table;
      current = next;
      collapsed = nextCollapsed;
      renderHead();
      if (tableChanged && element) {
        element.table = next.table;
      }
    },
    showVariable(name) {
      const box = searchBox();
      if (!box) return false;
      box.value = name;
      box.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      filterName.textContent = name;
      filter.hidden = false;
      return true;
    },
    clearFilter() {
      const box = searchBox();
      if (box && box.value) {
        box.value = "";
        box.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      }
      filter.hidden = true;
    },
    flash() {
      root.classList.remove("se-card--flash");
      // Force a reflow so re-adding the class restarts the animation.
      void root.offsetWidth;
      root.classList.add("se-card--flash");
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(
        () => root.classList.remove("se-card--flash"),
        prefersReducedMotion() ? 1500 : 1300
      );
    },
    destroy() {
      if (flashTimer) clearTimeout(flashTimer);
      element?.remove();
      element = undefined;
      root.remove();
    }
  };

  // Hide the filter notice again when the user edits the embedded search box themselves.
  body.addEventListener("input", (event) => {
    const origin = event.composedPath()[0];
    if (origin instanceof HTMLInputElement && origin.hasAttribute("data-dd-search") && !filter.hidden) {
      if (origin.value !== filterName.textContent) filter.hidden = true;
    }
  });

  renderHead();
  mountDictionary();
  return handle;
}
