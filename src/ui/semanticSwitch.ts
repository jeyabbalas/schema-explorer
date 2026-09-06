// The "Semantic search" switch with its model picker, status chip, retry link and the thin
// progress bar.

import type { AppActions } from "../app/actions";
import { EMBEDDING_MODELS, findModel, modelName } from "../search/models";
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
        ? "Loading model…"
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

/** The detail line of a picker item: "23M · Apache-2.0 · 23–46 MB". */
export function modelMeta(id: string, webGpu: boolean | undefined): string {
  const model = findModel(id);
  if (!model) return id;
  const parts = [`${model.params} params`, model.license, model.download];
  if (model.nonCommercial) parts.push("non-commercial use only");
  if (model.needsWebGpu) parts.push(webGpu === false ? "WebGPU unavailable in this browser" : "WebGPU only");
  return parts.join(" · ");
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
    "Finds related variables by meaning. Downloads the chosen model once (Hugging Face) and runs it on your device."
  );

  // Model picker: a menu of radio items; the summary names the current choice.
  const summaryName = el("span", { class: "se-model__name" });
  const summary = el(
    "summary",
    { class: "se-model__summary", "aria-haspopup": "menu" },
    summaryName,
    icon("chevron-down", 14)
  );
  const list = el("ul", {
    class: "se-menu__list se-model__list",
    role: "menu",
    "aria-label": "Embedding model"
  });
  const picker = el("details", { class: "se-menu se-model", "data-menu": "model" }, summary, list);
  const closePicker = (): void => {
    picker.open = false;
  };
  const items = new Map<string, HTMLButtonElement>();
  for (const model of EMBEDDING_MODELS) {
    const meta = el("span", { class: "se-model__meta" });
    const item = el(
      "button",
      {
        type: "button",
        class: "se-menu__item se-model__item",
        role: "menuitemradio",
        "aria-checked": "false",
        "data-model": model.id,
        onclick: () => {
          closePicker();
          void actions.setSemanticModel(model.id);
        }
      },
      icon("check", 16, "se-model__check"),
      el(
        "span",
        { class: "se-model__text" },
        el("span", { class: "se-model__name" }, model.name),
        el("span", { class: "se-model__summary-line" }, model.summary),
        meta
      )
    );
    items.set(model.id, item);
    list.appendChild(el("li", null, item));
  }

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
  container.append(switchButton, picker, tip, chip, retry);

  const onDocumentClick = (event: MouseEvent): void => {
    if (picker.open && event.target instanceof Node && !picker.contains(event.target)) closePicker();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && picker.open) {
      closePicker();
      summary.focus();
    }
  };
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKey);

  const renderPicker = (state: AppState): void => {
    const current = state.prefs.semanticModel;
    summaryName.textContent = modelName(current);
    summary.setAttribute("aria-label", `Embedding model: ${modelName(current)}`);
    summary.title = current;
    for (const [id, item] of items) {
      const model = findModel(id);
      const unavailable = (model?.needsWebGpu ?? false) && state.webGpu === false;
      item.setAttribute("aria-checked", String(id === current));
      item.disabled = unavailable;
      const meta = item.querySelector(".se-model__meta");
      if (meta) meta.textContent = modelMeta(id, state.webGpu);
    }
  };

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
      const model = findModel(semantic.model);
      chip.title = model ? `${semantic.model} · ${model.license}` : semantic.model;
    } else if (semantic.kind === "error") {
      replaceChildren(chip, icon("warning", 14), ` ${text}`);
      chip.title = [semantic.message, semantic.hint].filter(Boolean).join(" ");
    } else if (busy) {
      replaceChildren(chip, icon("spinner", 14), ` ${text}`);
      chip.title = modelName(state.prefs.semanticModel);
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
  renderPicker(store.get());
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.semantic !== prev.semantic || state.prefs !== prev.prefs) render(state);
    if (state.prefs !== prev.prefs || state.webGpu !== prev.webGpu) renderPicker(state);
  });
  return () => {
    unsubscribe();
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onKey);
    switchButton.remove();
    picker.remove();
    tip.remove();
    chip.remove();
    retry.remove();
  };
}
