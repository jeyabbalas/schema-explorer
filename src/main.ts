import "./styles/app.css";
import { createActions } from "./app/actions";
import { loadPrefs } from "./persist/prefs";
import { createStore } from "./state/store";
import { initialState } from "./state/types";
import { mountApp } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");

const store = createStore(initialState(loadPrefs()));
const actions = createActions(store);
mountApp(root, store, actions);
void actions.boot();

// After a deploy, a tab loaded before it may fail to load a hashed chunk: reload to the new version.
window.addEventListener("vite:preloadError", () => {
  window.location.reload();
});
