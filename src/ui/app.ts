// Assembles the page: landmarks, shared file pickers and every view, each subscribing to its
// own slice of the store.

import type { AppActions } from "../app/actions";
import type { Store } from "../state/store";
import type { AppState } from "../state/types";
import { mountShelf, revealCard, type ShelfHandle } from "./datasetShelf";
import { mountTray } from "./datasetTray";
import { el } from "./dom";
import { mountDropOverlay } from "./dropOverlay";
import { mountEmptyState } from "./emptyState";
import { mountFooter } from "./footer";
import { mountHeader } from "./header";
import { mountKeyboard } from "./keyboard";
import { mountResults } from "./results";
import { mountSearchBar, type SearchBarHandle } from "./searchBar";
import { mountNotices } from "./notices";
import { createPickers } from "./pickers";
import { mountTheme } from "./theme";

export interface AppHandle {
  root: HTMLElement;
  shelf: ShelfHandle;
  searchBar: SearchBarHandle;
  destroy(): void;
}

export function mountApp(root: HTMLElement, store: Store<AppState>, actions: AppActions): AppHandle {
  const app = el("div", { class: "se-app" });
  const skip = el("a", { class: "se-skip", href: "#se-main" }, "Skip to content");
  const main = el("main", { class: "se-main", id: "se-main", tabindex: "-1" });
  const searchSlot = el("div", { class: "se-slot se-slot--search" });
  const traySlot = el("div", { class: "se-slot se-slot--tray" });
  const emptySlot = el("div", { class: "se-slot se-slot--empty" });
  const resultsSlot = el("div", { class: "se-slot se-slot--results" });
  const shelfSlot = el("div", { class: "se-slot se-slot--shelf" });
  main.append(searchSlot, traySlot, emptySlot, resultsSlot, shelfSlot);
  const headerSlot = el("div", { class: "se-slot se-slot--header" });
  const footerSlot = el("div", { class: "se-slot se-slot--footer" });
  app.append(skip, headerSlot, main, footerSlot);
  root.replaceChildren(app);

  const pickers = createPickers(app, (files, kind) => {
    void actions.addFiles(files, kind);
  });
  const unmountTheme = mountTheme(store);
  const unmountHeader = mountHeader(headerSlot, store, actions, pickers);
  const unmountEmpty = mountEmptyState(emptySlot, store, actions, pickers);
  const unmountTray = mountTray(traySlot, store, actions, pickers);
  const searchBar = mountSearchBar(searchSlot, store, actions);
  const unmountResults = mountResults(resultsSlot, store, actions);
  const unmountKeyboard = mountKeyboard(() => searchBar.input, actions);
  const shelf = mountShelf(shelfSlot, store, actions);
  const unmountNotices = mountNotices(app, store, actions);
  const unmountDrop = mountDropOverlay(app, store, actions);
  const unmountFooter = mountFooter(footerSlot);

  actions.registerShelf({
    focusDataset(id) {
      const card = shelf.card(id);
      if (!card) return false;
      revealCard(card);
      card.flash();
      return true;
    },
    showVariable(id, name) {
      const card = shelf.card(id);
      if (!card) return false;
      revealCard(card);
      const shown = card.showVariable(name);
      card.flash();
      return shown;
    }
  });

  const announcer = el("div", { class: "se-visually-hidden", role: "status", "aria-live": "polite" });
  app.appendChild(announcer);
  const unsubscribeAnnounce = store.select(
    (state) => state.ui.announcement,
    (text) => {
      announcer.textContent = text;
    }
  );

  return {
    root: app,
    shelf,
    searchBar,
    destroy() {
      unsubscribeAnnounce();
      unmountFooter();
      unmountDrop();
      unmountNotices();
      shelf.destroy();
      unmountKeyboard();
      unmountResults();
      searchBar.destroy();
      unmountTray();
      unmountEmpty();
      unmountHeader();
      unmountTheme();
      pickers.destroy();
      app.remove();
    }
  };
}
