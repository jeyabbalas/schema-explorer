import "./styles/app.css";
import { createActions } from "./app/actions";
import { createDatasetsStore, DB_NAME, DB_VERSION, STORES } from "./persist/datasetsStore";
import { openKv } from "./persist/kv";
import { loadPrefs } from "./persist/prefs";
import { createSemanticController, workerConfigFromLocation } from "./search/semantic";
import { createStore } from "./state/store";
import { initialState } from "./state/types";
import { mountApp } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");

const store = createStore(initialState(loadPrefs()));
const workerConfig = workerConfigFromLocation(window.location.search);
const semantic = createSemanticController({ workerConfig });
const datasetsStore = createDatasetsStore(openKv(DB_NAME, DB_VERSION, STORES));
const actions = createActions(store, {
  semantic,
  datasetsStore,
  appVersion: __APP_VERSION__,
  // ?nogpu=1 hides WebGPU from the worker; the picker must agree with it.
  detectWebGpu: workerConfig.nogpu ? () => Promise.resolve(false) : undefined
});
mountApp(root, store, actions);
void actions.boot();

// Dev-only handle for poking at the state from the browser console.
if (import.meta.env.DEV) {
  (window as unknown as { __schemaExplorer?: unknown }).__schemaExplorer = { store, actions, semantic };
}

// After a deploy, a tab loaded before it may fail to load a hashed chunk: reload to the new version.
window.addEventListener("vite:preloadError", () => {
  window.location.reload();
});
