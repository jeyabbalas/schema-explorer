// The stack of dataset cards, reconciled by dataset id so each <json-data-dictionary> mounts once.

import type { AppActions } from "../app/actions";
import { shallowEqualArray, type Store } from "../state/store";
import type { AppState, Dataset } from "../state/types";
import { formatCount } from "../util/text";
import { createCard, type CardHandle } from "./datasetCard";
import { el, prefersReducedMotion } from "./dom";
import { resolveTheme } from "./theme";

export interface ShelfHandle {
  card(id: string): CardHandle | undefined;
  destroy(): void;
}

export function mountShelf(container: HTMLElement, store: Store<AppState>, actions: AppActions): ShelfHandle {
  const cards = new Map<string, CardHandle>();
  const list = el("div", { class: "se-shelf__list" });
  const count = el("span", { class: "se-shelf__count" });
  const toggleAll = el("button", {
    type: "button",
    class: "se-btn se-btn--ghost se-btn--sm",
    "data-action": "toggle-all",
    onclick: () => {
      const state = store.get();
      const anyExpanded = state.datasets.some((dataset) => !(state.ui.cards[dataset.id]?.collapsed ?? false));
      actions.setAllCardsCollapsed(anyExpanded);
    }
  });
  const section = el(
    "section",
    { class: "se-shelf", "aria-labelledby": "se-shelf-title", hidden: true },
    el(
      "div",
      { class: "se-container" },
      el(
        "div",
        { class: "se-shelf__head" },
        el("h2", { class: "se-shelf__title", id: "se-shelf-title" }, "Dictionaries ", count),
        toggleAll
      ),
      list
    )
  );
  container.appendChild(section);

  const collapsedOf = (state: AppState, id: string): boolean => state.ui.cards[id]?.collapsed ?? false;

  const reconcile = (state: AppState): void => {
    const datasets = state.datasets;
    section.hidden = datasets.length === 0;
    count.textContent = formatCount(datasets.length);
    const anyExpanded = datasets.some((dataset) => !collapsedOf(state, dataset.id));
    toggleAll.textContent = anyExpanded ? "Collapse all" : "Expand all";
    toggleAll.hidden = datasets.length === 0;

    const keep = new Set(datasets.map((dataset) => dataset.id));
    for (const [id, card] of cards) {
      if (!keep.has(id)) {
        card.destroy();
        cards.delete(id);
      }
    }
    const theme = resolveTheme(state.prefs.theme);
    let previous: HTMLElement | null = null;
    for (const dataset of datasets) {
      let card = cards.get(dataset.id);
      if (!card) {
        card = createCard(dataset, actions, { theme, collapsed: collapsedOf(state, dataset.id) });
        cards.set(dataset.id, card);
      } else {
        card.update(dataset, collapsedOf(state, dataset.id));
      }
      // Keep DOM order equal to dataset order without re-creating nodes.
      const expectedNext: Element | null = previous ? previous.nextElementSibling : list.firstElementChild;
      if (expectedNext !== card.root) list.insertBefore(card.root, expectedNext);
      previous = card.root;
    }
  };

  reconcile(store.get());
  const unsubscribeDatasets = store.select(
    (state) => state.datasets,
    () => reconcile(store.get()),
    shallowEqualArray
  );
  const unsubscribeCards = store.select(
    (state) => state.ui.cards,
    () => reconcile(store.get())
  );

  return {
    card: (id) => cards.get(id),
    destroy() {
      unsubscribeDatasets();
      unsubscribeCards();
      for (const card of cards.values()) card.destroy();
      cards.clear();
      section.remove();
    }
  };
}

/** Scroll a card into view (respecting reduced motion) and move focus to it. */
export function revealCard(card: CardHandle): void {
  card.root.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  card.root.focus({ preventScroll: true });
}

export function datasetsEqual(a: readonly Dataset[], b: readonly Dataset[]): boolean {
  return shallowEqualArray(a, b);
}
