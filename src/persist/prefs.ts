// Small preferences in localStorage (wrapped: storage can be unavailable or throw).

import { DEFAULT_MODEL_ID, isModelId } from "../search/models";
import type { Prefs, ThemePreference } from "../state/types";

export const THEME_KEY = "schema-explorer:theme";
export const SEMANTIC_KEY = "schema-explorer:semantic";
export const SEMANTIC_MODEL_KEY = "schema-explorer:semantic-model";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode or storage disabled: preferences simply do not persist */
  }
}

export function loadPrefs(): Prefs {
  const theme = read(THEME_KEY);
  const model = read(SEMANTIC_MODEL_KEY);
  return {
    theme: theme === "light" || theme === "dark" ? theme : "auto",
    semantic: read(SEMANTIC_KEY) === "1",
    // A model the picker no longer offers falls back to the default.
    semanticModel: isModelId(model) ? model : DEFAULT_MODEL_ID
  };
}

export function savePrefs(patch: Partial<Prefs>): void {
  if (patch.theme !== undefined) write(THEME_KEY, patch.theme === "auto" ? null : patch.theme);
  if (patch.semantic !== undefined) write(SEMANTIC_KEY, patch.semantic ? "1" : "0");
  if (patch.semanticModel !== undefined)
    write(SEMANTIC_MODEL_KEY, patch.semanticModel === DEFAULT_MODEL_ID ? null : patch.semanticModel);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "auto";
}
