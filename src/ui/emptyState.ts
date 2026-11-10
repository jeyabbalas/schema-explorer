import type { AppActions } from "../app/actions";
import type { Store } from "../state/store";
import type { AppState } from "../state/types";
import { el } from "./dom";
import { icon } from "./icons";
import type { Pickers } from "./pickers";

export function mountEmptyState(
  container: HTMLElement,
  store: Store<AppState>,
  actions: AppActions,
  pickers: Pickers
): () => void {
  const examplesButton = el(
    "button",
    {
      type: "button",
      class: "se-btn se-btn--primary",
      "data-action": "load-examples",
      onclick: () => {
        void actions.loadExamples();
      }
    },
    icon("sparkles"),
    el("span", { class: "se-empty__examples-label" }, "Load the example datasets")
  );
  const dropzone = el(
    "div",
    { class: "se-dropzone", "data-dragover": "false" },
    icon("upload", 32),
    el("h2", { class: "se-empty__title", id: "se-empty-title" }, "Drop schema files or a folder"),
    el(
      "p",
      { class: "se-empty__hint" },
      "JSON Schema documents describing tabular datasets — one root schema per table. Drop or choose the folder when schemas reference each other with relative $refs, so they resolve."
    ),
    el(
      "div",
      { class: "se-empty__actions" },
      el(
        "button",
        { type: "button", class: "se-btn", "data-action": "pick-files", onclick: () => pickers.pickFiles() },
        icon("file"),
        "Choose files"
      ),
      el(
        "button",
        {
          type: "button",
          class: "se-btn",
          "data-action": "pick-folder",
          onclick: () => pickers.pickFolder()
        },
        icon("folder"),
        "Choose folder"
      )
    )
  );
  const restoring = el(
    "p",
    { class: "se-empty__restoring", hidden: true },
    icon("spinner"),
    " Restoring saved datasets…"
  );
  const or = el("p", { class: "se-empty__or", "aria-hidden": "true" }, "or");
  const examplesHint = el("p", { class: "se-empty__hint" });
  const examples = el("div", { class: "se-empty__examples" }, examplesButton, examplesHint);
  const section = el(
    "section",
    { class: "se-empty", "aria-labelledby": "se-empty-title" },
    dropzone,
    or,
    examples,
    el(
      "p",
      { class: "se-empty__privacy" },
      icon("lock"),
      " Your schemas stay in this browser — nothing is uploaded. They are kept in local storage until you remove them."
    ),
    restoring
  );
  container.appendChild(section);

  const render = (state: AppState): void => {
    const hasDatasets = state.datasets.length > 0;
    section.hidden = hasDatasets;
    const isRestoring = state.phase === "booting";
    section.dataset.restoring = String(isRestoring);
    restoring.hidden = !isRestoring;
    dropzone.dataset.dragover = String(state.ui.dragOver);
    const manifest = state.examples;
    or.hidden = !manifest;
    examples.hidden = !manifest;
    examplesHint.textContent = manifest?.description ?? "";
    examplesHint.hidden = !manifest?.description;
    const loading = state.busy?.kind === "loading-examples";
    examplesButton.disabled = loading || isRestoring || state.busy?.kind === "ingesting";
    examplesButton.setAttribute("aria-busy", String(loading));
    const label = examplesButton.querySelector(".se-empty__examples-label");
    if (label) {
      label.textContent = loading
        ? state.busy?.progress !== undefined
          ? `Loading examples · ${Math.round(state.busy.progress * 100)}%`
          : "Loading examples…"
        : "Load the example datasets";
    }
  };
  render(store.get());
  const unsubscribe = store.subscribe(render);
  return () => {
    unsubscribe();
    section.remove();
  };
}
