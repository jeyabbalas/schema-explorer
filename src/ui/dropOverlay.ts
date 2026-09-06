// Whole-page drag-and-drop: a fixed overlay while files are dragged over the window, and the
// drop itself is handled at document level so it works anywhere on the page.

import type { AppActions } from "../app/actions";
import type { Store } from "../state/store";
import type { AppState } from "../state/types";
import { el } from "./dom";
import { icon } from "./icons";

function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return !!types && Array.from(types).includes("Files");
}

export function mountDropOverlay(
  container: HTMLElement,
  store: Store<AppState>,
  actions: AppActions
): () => void {
  const overlay = el(
    "div",
    { class: "se-dropover", hidden: true, "aria-hidden": "true" },
    el(
      "div",
      { class: "se-dropover__box" },
      icon("upload", 40),
      el("p", { class: "se-dropover__title" }, "Drop to add datasets"),
      el("p", { class: "se-dropover__hint" }, "Files or a folder · stays in your browser")
    )
  );
  container.appendChild(overlay);

  let depth = 0;
  const setDragOver = (over: boolean): void => {
    if (store.get().ui.dragOver !== over) store.set((state) => ({ ui: { ...state.ui, dragOver: over } }));
  };
  const onEnter = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    setDragOver(true);
  };
  const onOver = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const onLeave = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setDragOver(false);
  };
  const onDrop = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    setDragOver(false);
    if (event.dataTransfer) void actions.addDrop(event.dataTransfer);
  };
  const onWindowBlur = (): void => {
    depth = 0;
    setDragOver(false);
  };
  document.addEventListener("dragenter", onEnter);
  document.addEventListener("dragover", onOver);
  document.addEventListener("dragleave", onLeave);
  document.addEventListener("drop", onDrop);
  window.addEventListener("blur", onWindowBlur);

  const unsubscribe = store.select(
    (state) => state.ui.dragOver,
    (over) => {
      overlay.hidden = !over;
    }
  );
  return () => {
    unsubscribe();
    document.removeEventListener("dragenter", onEnter);
    document.removeEventListener("dragover", onOver);
    document.removeEventListener("dragleave", onLeave);
    document.removeEventListener("drop", onDrop);
    window.removeEventListener("blur", onWindowBlur);
    overlay.remove();
  };
}
