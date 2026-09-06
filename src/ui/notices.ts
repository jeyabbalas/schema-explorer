import type { AppActions } from "../app/actions";
import type { Store } from "../state/store";
import type { AppState, Notice } from "../state/types";
import { el } from "./dom";
import { icon } from "./icons";

const AUTO_DISMISS_MS = 8000;

export function mountNotices(
  container: HTMLElement,
  store: Store<AppState>,
  actions: AppActions
): () => void {
  const region = el("div", { class: "se-toasts", role: "region", "aria-label": "Notifications" });
  container.appendChild(region);
  const toasts = new Map<string, { node: HTMLElement; timer: ReturnType<typeof setTimeout> | undefined }>();

  const createToast = (notice: Notice): HTMLElement => {
    const body = el("div", { class: "se-toast__body" }, el("p", null, notice.text));
    if (notice.details && notice.details.length > 0) {
      body.appendChild(
        el(
          "details",
          { class: "se-toast__details" },
          el("summary", null, "Details"),
          el(
            "ul",
            null,
            notice.details.map((line) => el("li", null, el("code", null, line)))
          )
        )
      );
    }
    if (notice.action) {
      body.appendChild(
        el(
          "button",
          {
            type: "button",
            class: "se-btn se-btn--link",
            "data-action": "undo",
            onclick: () => actions.runNoticeAction(notice.id)
          },
          notice.action.label
        )
      );
    }
    const toast = el(
      "div",
      { class: "se-toast", "data-kind": notice.level, role: notice.level === "error" ? "alert" : "status" },
      icon(notice.level === "info" ? "info-circle" : "warning"),
      body,
      el(
        "button",
        {
          type: "button",
          class: "se-iconbtn",
          "aria-label": "Dismiss",
          onclick: () => actions.dismissNotice(notice.id)
        },
        icon("close", 14)
      )
    );
    return toast;
  };

  const schedule = (
    notice: Notice,
    entry: { node: HTMLElement; timer: ReturnType<typeof setTimeout> | undefined }
  ): void => {
    if (notice.level !== "info") return;
    const start = (): void => {
      entry.timer = setTimeout(() => actions.dismissNotice(notice.id), AUTO_DISMISS_MS);
    };
    const stop = (): void => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
    };
    entry.node.addEventListener("mouseenter", stop);
    entry.node.addEventListener("focusin", stop);
    entry.node.addEventListener("mouseleave", start);
    entry.node.addEventListener("focusout", start);
    entry.node.addEventListener("toggle", stop, true);
    start();
  };

  const render = (notices: readonly Notice[]): void => {
    const keep = new Set(notices.map((notice) => notice.id));
    for (const [id, entry] of toasts) {
      if (!keep.has(id)) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.node.remove();
        toasts.delete(id);
      }
    }
    for (const notice of notices) {
      if (toasts.has(notice.id)) continue;
      const entry = { node: createToast(notice), timer: undefined };
      toasts.set(notice.id, entry);
      region.appendChild(entry.node);
      schedule(notice, entry);
    }
  };
  render(store.get().notices);
  const unsubscribe = store.select((state) => state.notices, render);
  return () => {
    unsubscribe();
    for (const entry of toasts.values()) if (entry.timer) clearTimeout(entry.timer);
    region.remove();
  };
}
