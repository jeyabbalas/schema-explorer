// The "Semantic search" switch with its status chip, retry link and the thin progress bar.

import type { AppActions } from "../app/actions";
import { EMBEDDING_MODEL } from "../search/constants";
import type { Store } from "../state/store";
import type { AppState, SemanticState } from "../state/types";
import { formatCount } from "../util/text";
import { el, replaceChildren } from "./dom";
import { icon } from "./icons";

const DEVICE_LABELS: Record<string, string> = { webgpu: "WebGPU", wasm: "WASM", cpu: "CPU" };

export function formatEta(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes - hours * 60} min`;
}

export function chipText(state: SemanticState): string {
  switch (state.kind) {
    case "off":
      return "";
    case "starting":
      return "Starting…";
    case "loading":
      return state.progress === undefined || state.progress >= 1
        ? "Downloading model…"
        : `Downloading model · ${Math.round(state.progress * 100)}%`;
    case "indexing":
      return `Indexing · ${formatCount(state.done)} / ${formatCount(state.total)}${state.etaMs !== undefined ? ` · ≈ ${formatEta(state.etaMs)} left` : ""}`;
    case "ready": {
      const device = state.device ? (DEVICE_LABELS[state.device.toLowerCase()] ?? state.device) : undefined;
      return `Semantic: ready${device ? ` · ${device}` : ""}${state.mainThread ? " (main thread)" : ""}`;
    }
    case "error":
      return "Semantic search unavailable";
  }
}

export function mountSemanticSwitch(
  container: HTMLElement,
  store: Store<AppState>,
  actions: AppActions,
  progress: HTMLProgressElement
): () => void {
  const switchButton = el(
    "button",
    {
      type: "button",
      role: "switch",
      class: "se-switch",
      "aria-checked": "false",
      "aria-describedby": "se-semantic-help",
      onclick: () => {
        void actions.setSemantic(!store.get().prefs.semantic);
      }
    },
    el(
      "span",
      { class: "se-switch__track", "aria-hidden": "true" },
      el("span", { class: "se-switch__thumb" })
    ),
    el("span", { class: "se-switch__label" }, "Semantic search")
  );
  const tip = el(
    "span",
    { id: "se-semantic-help", class: "se-tip", role: "tooltip" },
    "Finds related variables by meaning. Downloads a 23 MB model once (Hugging Face), runs on your device."
  );
  const chip = el("span", { class: "se-chip se-chip--status", role: "status", hidden: true });
  const retry = el(
    "button",
    {
      type: "button",
      class: "se-btn se-btn--link",
      "data-action": "semantic-retry",
      hidden: true,
      onclick: () => {
        void actions.retrySemantic();
      }
    },
    "Retry"
  );
  container.append(switchButton, tip, chip, retry);

  const render = (state: AppState): void => {
    const semantic = state.semantic;
    switchButton.setAttribute("aria-checked", String(state.prefs.semantic));
    const busy = semantic.kind === "starting" || semantic.kind === "loading" || semantic.kind === "indexing";
    if (busy) switchButton.setAttribute("aria-busy", "true");
    else switchButton.removeAttribute("aria-busy");

    const text = chipText(semantic);
    chip.hidden = semantic.kind === "off";
    chip.dataset.state = semantic.kind === "starting" ? "loading" : semantic.kind;
    if (semantic.kind === "ready") {
      replaceChildren(chip, icon("sparkles", 14), ` ${text}`);
      chip.title = EMBEDDING_MODEL;
    } else if (semantic.kind === "error") {
      replaceChildren(chip, icon("warning", 14), ` ${text}`);
      chip.title = [semantic.message, semantic.hint].filter(Boolean).join(" ");
    } else if (busy) {
      replaceChildren(chip, icon("spinner", 14), ` ${text}`);
      chip.removeAttribute("title");
    } else {
      chip.textContent = text;
      chip.removeAttribute("title");
    }
    retry.hidden = semantic.kind !== "error";

    let value: number | undefined;
    if (semantic.kind === "loading" && semantic.progress !== undefined && semantic.progress < 1)
      value = semantic.progress;
    else if (semantic.kind === "indexing") value = semantic.coverage;
    progress.hidden = value === undefined;
    if (value !== undefined) progress.value = value;
  };
  render(store.get());
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.semantic !== prev.semantic || state.prefs !== prev.prefs) render(state);
  });
  return () => {
    unsubscribe();
    switchButton.remove();
    tip.remove();
    chip.remove();
    retry.remove();
  };
}
