import type { Store } from "../state/store";
import type { AppState, ThemePreference } from "../state/types";

export type ResolvedTheme = "light" | "dark";

const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#f7f8fa", dark: "#0f1319" };

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "auto") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

/** Stamp the resolved theme on <html> and keep the browser UI colour in step. */
export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const theme = resolveTheme(pref);
  document.documentElement.dataset.theme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR[theme];
  return theme;
}

/** Keep the document theme in sync with the preference and, while "auto", with the system. */
export function mountTheme(store: Store<AppState>): () => void {
  applyTheme(store.get().prefs.theme);
  const unsubscribe = store.select(
    (state) => state.prefs.theme,
    (pref) => {
      applyTheme(pref);
    }
  );
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
  const onChange = (): void => {
    if (store.get().prefs.theme === "auto") applyTheme("auto");
  };
  media?.addEventListener?.("change", onChange);
  return () => {
    unsubscribe();
    media?.removeEventListener?.("change", onChange);
  };
}
