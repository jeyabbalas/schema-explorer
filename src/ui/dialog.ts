import { el } from "./dom";

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string | undefined;
  danger?: boolean | undefined;
}

/** A native <dialog> confirmation; resolves true when confirmed. Falls back to window.confirm. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const dialog = el("dialog", { class: "se-dialog", "aria-labelledby": "se-dialog-title" });
  if (typeof dialog.showModal !== "function") {
    dialog.remove();
    return Promise.resolve(window.confirm(`${options.title}\n\n${options.body}`));
  }
  return new Promise((resolve) => {
    let result = false;
    const cancel = el(
      "button",
      { type: "button", class: "se-btn", value: "cancel" },
      options.cancelLabel ?? "Cancel"
    );
    const confirm = el(
      "button",
      {
        type: "submit",
        class: `se-btn ${options.danger ? "se-btn--danger" : "se-btn--primary"}`,
        value: "confirm"
      },
      options.confirmLabel
    );
    const form = el(
      "form",
      { method: "dialog", class: "se-dialog__form" },
      el("h2", { class: "se-dialog__title", id: "se-dialog-title" }, options.title),
      el("p", { class: "se-dialog__body" }, options.body),
      el("div", { class: "se-dialog__actions" }, cancel, confirm)
    );
    confirm.addEventListener("click", () => {
      result = true;
    });
    cancel.addEventListener("click", () => {
      result = false;
      dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
