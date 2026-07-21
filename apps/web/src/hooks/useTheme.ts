// FILE: useTheme.ts
// Purpose: Persists the theme state and projects it into DOM CSS variables.
// Layer: Web appearance state hook
// Exports: useTheme for keeping the DOM synced with the persisted (and cross-tab) theme state.

import { useEffect, useSyncExternalStore } from "react";
import { isElectron } from "../env";
import { isMacPlatform } from "../lib/utils";
import {
  DEFAULT_THEME_STATE,
  type ThemeState,
  type ThemeVariant,
  buildThemeCssVariables,
  parseStoredThemeState,
  resolveThemePackForVariant,
  serializeThemeState,
} from "../theme/theme.logic";

const STORAGE_KEY = "teacode:theme";
const APPEARANCE_MODE_KEY = "teacode:appearance-mode";

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeState | null = null;
let lastSnapshotKey = "";
let desktopThemeSynced = false;
let lastSyncedVariant: ThemeVariant | null = null;

// ─── Appearance mode (system / light / dark) ─────────────────────────────

export type AppearanceMode = "system" | ThemeVariant;

function readAppearanceMode(): AppearanceMode {
  if (typeof localStorage === "undefined") return "dark";
  const raw = localStorage.getItem(APPEARANCE_MODE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "dark";
}

function writeAppearanceMode(mode: AppearanceMode): void {
  try {
    localStorage.setItem(APPEARANCE_MODE_KEY, mode);
  } catch {
    /* noop */
  }
}

const systemDarkQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function resolveVariant(mode: AppearanceMode): ThemeVariant {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  // system: follow OS preference, default dark
  return systemDarkQuery?.matches !== false ? "dark" : "light";
}

let systemModeListeners: Array<() => void> = [];

function onSystemColorSchemeChange() {
  if (readAppearanceMode() !== "system") return;
  for (const listener of systemModeListeners) listener();
}

if (systemDarkQuery) {
  systemDarkQuery.addEventListener("change", onSystemColorSchemeChange);
}

function subscribeSystemMode(listener: () => void): () => void {
  systemModeListeners.push(listener);
  return () => {
    systemModeListeners = systemModeListeners.filter((l) => l !== listener);
  };
}

// ─── Store wiring ─────────────────────────────────────────────────────────

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function hasThemeStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readStoredThemeState(): ThemeState {
  if (!hasThemeStorage()) {
    return DEFAULT_THEME_STATE;
  }

  try {
    const base = parseStoredThemeState(localStorage.getItem(STORAGE_KEY));
    const mode = readAppearanceMode();
    const variant = resolveVariant(mode);
    return { ...base, variant };
  } catch {
    return DEFAULT_THEME_STATE;
  }
}

function getSnapshot(): ThemeState {
  const state = readStoredThemeState();
  const snapshotKey = serializeThemeState(state);

  if (lastSnapshot && lastSnapshotKey === snapshotKey) {
    return lastSnapshot;
  }

  lastSnapshotKey = snapshotKey;
  lastSnapshot = state;
  return lastSnapshot;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  listeners.push(listener);

  // Another tab/window persisted a theme change; re-apply and notify.
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== APPEARANCE_MODE_KEY) {
      return;
    }
    applyThemeState(readStoredThemeState(), true);
    emitChange();
  };

  window.addEventListener("storage", handleStorage);
  const unsubSystem = subscribeSystemMode(() => {
    applyThemeState(readStoredThemeState(), true);
    emitChange();
  });

  return () => {
    listeners = listeners.filter((currentListener) => currentListener !== listener);
    window.removeEventListener("storage", handleStorage);
    unsubSystem();
  };
}

// ─── DOM projection ───────────────────────────────────────────────────────

function applyThemeState(state: ThemeState, suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  const root = document.documentElement;
  // Some server-rendered tests stub only the tiny DOM surface they need.
  if (
    typeof root.classList?.add !== "function" ||
    typeof root.style?.setProperty !== "function" ||
    typeof root.style?.removeProperty !== "function"
  ) {
    return;
  }

  if (suppressTransitions) {
    root.classList.add("no-transitions");
  }

  const variant = state.variant;
  const activeTheme = resolveThemePackForVariant(state);
  const cssVariableBuild = buildThemeCssVariables(activeTheme, {
    electron: isElectron,
    isMac: isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform),
    variant,
  });

  // Tailwind's `dark:` utilities key off this class everywhere.
  if (variant === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.setAttribute("data-code-theme-id", activeTheme.codeThemeId);
  root.setAttribute("data-theme-variant", variant);
  root.setAttribute("data-window-material", cssVariableBuild.material);
  root.style.setProperty("color-scheme", variant);

  for (const [name, value] of Object.entries(cssVariableBuild.variables)) {
    if (value.trim().length === 0) {
      root.style.removeProperty(name);
      continue;
    }
    root.style.setProperty(name, value);
  }

  syncDesktopTheme(variant);

  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal.
    // oxlint-disable-next-line no-unused-expressions
    root.offsetHeight;
    requestAnimationFrame(() => {
      root.classList.remove("no-transitions");
    });
  }
}

function syncDesktopTheme(variant: ThemeVariant) {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = window.desktopBridge;
  if (!bridge) {
    return;
  }

  if (desktopThemeSynced && lastSyncedVariant === variant) {
    return;
  }

  desktopThemeSynced = true;
  lastSyncedVariant = variant;
  void bridge.setTheme(variant).catch(() => {
    desktopThemeSynced = false;
    lastSyncedVariant = null;
  });
}

// Apply immediately on module load to minimize flash before React mounts.
if (typeof document !== "undefined") {
  applyThemeState(readStoredThemeState());
}

// ─── Public hook ──────────────────────────────────────────────────────────

/**
 * Keeps the DOM theme projection in sync with the persisted theme state,
 * including cross-tab updates via the "storage" event. The initial apply
 * already happens at module load, so this is a no-op unless something else
 * changes the persisted state out from under the current tab.
 */
export function useTheme(): void {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_THEME_STATE);

  useEffect(() => {
    applyThemeState(state);
  }, [state]);
}

// ─── Public helpers for settings UI ───────────────────────────────────────

export function getAppearanceMode(): AppearanceMode {
  return readAppearanceMode();
}

export function setAppearanceMode(mode: AppearanceMode): void {
  writeAppearanceMode(mode);
  // Trigger re-evaluation for the current tab.
  applyThemeState(readStoredThemeState(), true);
  emitChange();
}
