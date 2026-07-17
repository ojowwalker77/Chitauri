// FILE: useTheme.ts
// Purpose: Persists the appearance mode and projects the fixed Claude palette into DOM CSS variables.
// Layer: Web appearance state hook
// Exports: useTheme for the system, light, and dark appearance modes.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { isElectron } from "../env";
import { isMacPlatform } from "../lib/utils";
import {
  DEFAULT_THEME_STATE,
  type ThemeMode,
  type ThemeState,
  buildThemeCssVariables,
  parseStoredThemeState,
  resolveThemePack,
  resolveThemeVariant,
  serializeThemeState,
} from "../theme/theme.logic";

type ThemeSnapshot = {
  state: ThemeState;
  systemDark: boolean;
};

const STORAGE_KEY = "teacode:theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastSnapshotKey = "";
let lastDesktopTheme: ThemeMode | null = null;

// ─── Store wiring ─────────────────────────────────────────────────────────

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function hasThemeStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function getSystemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MEDIA_QUERY).matches;
}

function readStoredThemeState(): ThemeState {
  if (!hasThemeStorage()) {
    return DEFAULT_THEME_STATE;
  }

  try {
    return parseStoredThemeState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_STATE;
  }
}

function writeStoredThemeState(state: ThemeState) {
  if (!hasThemeStorage()) {
    return;
  }

  localStorage.setItem(STORAGE_KEY, serializeThemeState(state));
}

function getSnapshot(): ThemeSnapshot {
  const state = readStoredThemeState();
  const systemDark = state.mode === "system" ? getSystemDark() : false;
  const snapshotKey = `${serializeThemeState(state)}|${systemDark ? "dark" : "light"}`;

  if (lastSnapshot && lastSnapshotKey === snapshotKey) {
    return lastSnapshot;
  }

  lastSnapshotKey = snapshotKey;
  lastSnapshot = { state, systemDark };
  return lastSnapshot;
}

function updateStoredThemeState(update: (state: ThemeState) => ThemeState) {
  const nextState = update(readStoredThemeState());
  writeStoredThemeState(nextState);
  applyThemeState(nextState, true);
  emitChange();
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  listeners.push(listener);

  const mediaQuery = window.matchMedia(MEDIA_QUERY);
  const handleMediaChange = () => {
    const state = readStoredThemeState();
    if (state.mode === "system") {
      applyThemeState(state, true);
    }
    emitChange();
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    applyThemeState(readStoredThemeState(), true);
    emitChange();
  };

  mediaQuery.addEventListener("change", handleMediaChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((currentListener) => currentListener !== listener);
    mediaQuery.removeEventListener("change", handleMediaChange);
    window.removeEventListener("storage", handleStorage);
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
    typeof root.classList?.toggle !== "function" ||
    typeof root.style?.setProperty !== "function" ||
    typeof root.style?.removeProperty !== "function"
  ) {
    return;
  }

  if (suppressTransitions) {
    root.classList.add("no-transitions");
  }

  const variant = resolveThemeVariant(state.mode, getSystemDark());
  const activeTheme = resolveThemePack(state, variant);
  const cssVariableBuild = buildThemeCssVariables(activeTheme, variant, {
    electron: isElectron,
    isMac: isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform),
  });

  root.classList.toggle("dark", variant === "dark");
  root.setAttribute("data-code-theme-id", activeTheme.codeThemeId);
  root.setAttribute("data-theme-mode", state.mode);
  root.setAttribute("data-theme-variant", variant);
  root.setAttribute("data-window-material", cssVariableBuild.material);

  for (const [name, value] of Object.entries(cssVariableBuild.variables)) {
    if (value.trim().length === 0) {
      root.style.removeProperty(name);
      continue;
    }
    root.style.setProperty(name, value);
  }

  syncDesktopTheme(state.mode);

  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal.
    // oxlint-disable-next-line no-unused-expressions
    root.offsetHeight;
    requestAnimationFrame(() => {
      root.classList.remove("no-transitions");
    });
  }
}

function syncDesktopTheme(theme: ThemeMode) {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = window.desktopBridge;
  if (!bridge || lastDesktopTheme === theme) {
    return;
  }

  lastDesktopTheme = theme;
  void bridge.setTheme(theme).catch(() => {
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null;
    }
  });
}

// Apply immediately on module load to minimize flash before React mounts.
if (typeof document !== "undefined") {
  applyThemeState(readStoredThemeState());
}

// ─── Public hook ──────────────────────────────────────────────────────────

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => ({
    state: DEFAULT_THEME_STATE,
    systemDark: false,
  }));
  const theme = snapshot.state.mode;
  const resolvedTheme = resolveThemeVariant(theme, snapshot.systemDark);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    updateStoredThemeState((state) => ({
      ...state,
      mode: nextTheme,
    }));
  }, []);

  // Keep the DOM synced if something bypassed the immediate module-load apply.
  useEffect(() => {
    applyThemeState(snapshot.state);
  }, [snapshot.state]);

  return {
    resolvedTheme,
    setTheme,
    theme,
  } as const;
}

export type { ThemeMode };
