import type { AppActions } from "../app/actions";
import type { Store } from "../state/store";
import type { AppState } from "../state/types";
import { el } from "./dom";
import { icon } from "./icons";
import type { Pickers } from "./pickers";
import { resolveTheme } from "./theme";

const REPO_URL = "https://github.com/jeyabbalas/schema-explorer";

export function mountHeader(
  container: HTMLElement,
  store: Store<AppState>,
  actions: AppActions,
  pickers: Pickers
): () => void {
  const examplesItem = el(
    "li",
    null,
    el(
      "button",
      {
        type: "button",
        class: "se-menu__item",
        role: "menuitem",
        "data-action": "load-examples",
        onclick: () => {
          closeMenu();
          void actions.loadExamples();
        }
      },
      icon("sparkles"),
      "Load example datasets"
    )
  );
  const menuList = el(
    "ul",
    { class: "se-menu__list", role: "menu" },
    el(
      "li",
      null,
      el(
        "button",
        {
          type: "button",
          class: "se-menu__item",
          role: "menuitem",
          "data-action": "pick-files",
          onclick: () => {
            closeMenu();
            pickers.pickFiles();
          }
        },
        icon("file"),
        "Files…"
      )
    ),
    el(
      "li",
      null,
      el(
        "button",
        {
          type: "button",
          class: "se-menu__item",
          role: "menuitem",
          "data-action": "pick-folder",
          onclick: () => {
            closeMenu();
            pickers.pickFolder();
          }
        },
        icon("folder"),
        "Folder…"
      )
    ),
    examplesItem
  );
  const menu = el(
    "details",
    { class: "se-menu", "data-menu": "add" },
    el("summary", { class: "se-btn se-btn--sm" }, icon("plus"), "Add datasets"),
    menuList
  );
  const closeMenu = (): void => {
    menu.open = false;
  };

  const themeButton = el("button", {
    type: "button",
    class: "se-iconbtn",
    "data-action": "theme",
    onclick: () => {
      const next = resolveTheme(store.get().prefs.theme) === "dark" ? "light" : "dark";
      actions.setTheme(next);
    }
  });
  const renderThemeButton = (): void => {
    const current = resolveTheme(store.get().prefs.theme);
    themeButton.replaceChildren(icon(current === "dark" ? "sun" : "moon", 18));
    themeButton.setAttribute(
      "aria-label",
      current === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
    themeButton.title = themeButton.getAttribute("aria-label") ?? "";
  };
  renderThemeButton();

  const header = el(
    "header",
    { class: "se-header" },
    el(
      "div",
      { class: "se-container se-header__row" },
      el(
        "a",
        { class: "se-brand", href: "./" },
        icon("layers", 20, "se-brand__mark"),
        el("span", { class: "se-brand__name" }, "Schema Explorer")
      ),
      el("p", { class: "se-header__tagline" }, "Compare data dictionaries across cohorts"),
      el(
        "div",
        { class: "se-header__actions" },
        menu,
        themeButton,
        el(
          "a",
          {
            class: "se-iconbtn",
            href: REPO_URL,
            rel: "noopener",
            "aria-label": "GitHub repository",
            title: "GitHub"
          },
          icon("github", 18)
        )
      )
    )
  );
  container.appendChild(header);

  const onDocumentClick = (event: MouseEvent): void => {
    if (menu.open && event.target instanceof Node && !menu.contains(event.target)) closeMenu();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && menu.open) closeMenu();
  };
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKey);

  const unsubscribeDatasets = store.select(
    (state) => state.datasets.length > 0,
    (loaded) => {
      menu.hidden = !loaded;
    }
  );
  menu.hidden = store.get().datasets.length === 0;
  const unsubscribeExamples = store.select(
    (state) => state.examples,
    (manifest) => {
      examplesItem.hidden = !manifest;
    }
  );
  examplesItem.hidden = !store.get().examples;
  const unsubscribeTheme = store.select((state) => state.prefs.theme, renderThemeButton);
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
  media?.addEventListener?.("change", renderThemeButton);

  return () => {
    unsubscribeDatasets();
    unsubscribeExamples();
    unsubscribeTheme();
    media?.removeEventListener?.("change", renderThemeButton);
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onKey);
    header.remove();
  };
}
