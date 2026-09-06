// Mount the whole app into happy-dom for smoke tests.

import { createActions, type AppActions } from "../../src/app/actions";
import { createStore, type Store } from "../../src/state/store";
import { initialState, type AppState } from "../../src/state/types";
import { mountApp, type AppHandle } from "../../src/ui/app";

export interface TestApp {
  root: HTMLElement;
  store: Store<AppState>;
  actions: AppActions;
  app: AppHandle;
  destroy(): void;
}

export function mountTestApp(): TestApp {
  const root = document.createElement("div");
  root.id = "app";
  document.body.appendChild(root);
  const store = createStore(initialState({ theme: "light", semantic: false }));
  const actions = createActions(store, { yield: () => Promise.resolve() });
  const app = mountApp(root, store, actions);
  return {
    root,
    store,
    actions,
    app,
    destroy() {
      app.destroy();
      root.remove();
    }
  };
}

/** Poll until `predicate` holds (or fail after `timeoutMs`). */
export async function until(
  predicate: () => boolean,
  timeoutMs = 10_000,
  label = "condition"
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Set an input's value the way a user would (fires `input`). */
export function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function texts(root: ParentNode, selector: string): string[] {
  return Array.from(root.querySelectorAll(selector)).map((node) => node.textContent?.trim() ?? "");
}
