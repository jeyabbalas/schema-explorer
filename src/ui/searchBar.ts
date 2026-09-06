// The one search box that searches across every loaded dataset (sticky while datasets are loaded).

import type { AppActions } from "../app/actions";
import { totalVariables } from "../state/selectors";
import type { Store } from "../state/store";
import type { AppState } from "../state/types";
import { formatCount, pluralize } from "../util/text";
import { el } from "./dom";
import { icon } from "./icons";

export interface SearchBarHandle {
  input: HTMLInputElement;
  /** Where the semantic switch mounts. */
  semanticSlot: HTMLElement;
  section: HTMLElement;
  destroy(): void;
}

export function summaryText(state: AppState): string {
  const n = state.datasets.length;
  const result = state.search.result;
  if (state.search.query.trim().length === 0 || !result) {
    return n === 0
      ? ""
      : `${pluralize(n, "dataset")} · ${pluralize(totalVariables(state.datasets), "variable")}`;
  }
  const hits = result.totalExact + result.totalRelated;
  let text: string;
  if (hits === 0) {
    text = `No matches in any of ${pluralize(n, "dataset")}`;
  } else {
    const parts = [`Found in ${formatCount(result.datasetsWithHits)} of ${pluralize(n, "dataset")}`];
    if (result.totalExact > 0) parts.push(`${formatCount(result.totalExact)} exact`);
    if (result.totalRelated > 0) parts.push(`${formatCount(result.totalRelated)} related`);
    text = parts.join(" · ");
  }
  if (result.semantic.state === "pending") text += " · looking for related variables…";
  else if (result.semantic.state === "partial")
    text += ` · related results are partial (${Math.round(result.semantic.coverage * 100)}%)`;
  return text;
}

export function mountSearchBar(
  container: HTMLElement,
  store: Store<AppState>,
  actions: AppActions
): SearchBarHandle {
  const input = el("input", {
    id: "se-q",
    class: "se-search__input",
    type: "search",
    autocomplete: "off",
    spellcheck: "false",
    enterkeyhint: "search",
    placeholder: "Search all datasets — try “smoking status”, “age at menarche”, “BMI”",
    "aria-label": "Search all datasets",
    "aria-describedby": "se-summary",
    "aria-controls": "se-results"
  });
  const kbd = el("kbd", { class: "se-search__kbd", "aria-hidden": "true" }, "/");
  const mini = el("span", { class: "se-search__mini", "aria-hidden": "true" });
  const clearButton = el(
    "button",
    {
      type: "button",
      class: "se-iconbtn se-search__clear",
      "aria-label": "Clear search",
      hidden: true,
      onclick: () => {
        input.value = "";
        actions.setQuery("");
        input.focus();
      }
    },
    icon("close")
  );
  const summaryLink = el("a", { href: "#se-results" });
  const summary = el("p", { class: "se-search__summary", id: "se-summary" }, summaryLink);
  const live = el("span", { class: "se-visually-hidden", role: "status", "aria-live": "polite" });
  const semanticSlot = el("div", { class: "se-semantic" });
  const progress = el("progress", {
    class: "se-search__progress",
    max: "1",
    value: "0",
    "aria-hidden": "true",
    hidden: true
  });
  const section = el(
    "section",
    { class: "se-search", "aria-label": "Search all datasets", hidden: true },
    el(
      "div",
      { class: "se-container se-search__row" },
      el("div", { class: "se-search__field" }, icon("search", 18), input, kbd, mini, clearButton),
      summary,
      live,
      semanticSlot
    ),
    progress
  );
  container.appendChild(section);

  let frame: number | undefined;
  input.addEventListener("input", () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      actions.setQuery(input.value);
    });
  });
  input.addEventListener("focus", () => {
    kbd.hidden = true;
  });
  input.addEventListener("blur", () => {
    kbd.hidden = input.value.length > 0;
  });

  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  const render = (state: AppState): void => {
    section.hidden = state.datasets.length === 0;
    if (state.search.query !== input.value && document.activeElement !== input)
      input.value = state.search.query;
    const hasQuery = state.search.query.trim().length > 0;
    clearButton.hidden = !hasQuery;
    kbd.hidden = hasQuery || document.activeElement === input;
    const text = summaryText(state);
    const result = state.search.result;
    if (hasQuery && result) {
      summaryLink.textContent = text;
      summaryLink.removeAttribute("aria-hidden");
      summary.replaceChildren(summaryLink);
      mini.textContent = `${formatCount(result.datasetsWithHits)}/${state.datasets.length} · ${formatCount(result.totalExact + result.totalRelated)}`;
    } else {
      summary.textContent = text;
      mini.textContent = "";
    }
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (live.textContent !== text) live.textContent = text;
    }, 300);
  };
  render(store.get());
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.search !== prev.search || state.datasets !== prev.datasets || state.semantic !== prev.semantic)
      render(state);
  });

  return {
    input,
    semanticSlot,
    section,
    destroy() {
      unsubscribe();
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (liveTimer) clearTimeout(liveTimer);
      section.remove();
    }
  };
}
