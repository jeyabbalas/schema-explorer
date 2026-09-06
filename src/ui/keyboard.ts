// Global keyboard shortcuts. Registered in the CAPTURE phase on document because every
// embedded <json-data-dictionary> registers its own document-level "/" handler; without
// stopPropagation the last card's search box would take the focus instead of the global one.

import type { AppActions } from "../app/actions";
import { eventOrigin, isTypingTarget } from "./dom";

export function mountKeyboard(getInput: () => HTMLInputElement | null, actions: AppActions): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const input = getInput();
    if (!input || input.closest("section")?.hidden) return;
    const origin = eventOrigin(event);
    if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(origin)) {
      event.preventDefault();
      event.stopPropagation();
      input.focus();
      input.select();
      return;
    }
    if (origin !== input) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (input.value.length > 0) {
        input.value = "";
        actions.setQuery("");
      } else {
        input.blur();
      }
    } else if (event.key === "Enter") {
      const results = document.getElementById("se-results");
      if (results && !results.hidden) {
        event.preventDefault();
        results.focus({ preventScroll: false });
      }
    }
  };
  document.addEventListener("keydown", onKeyDown, true);
  return () => document.removeEventListener("keydown", onKeyDown, true);
}
