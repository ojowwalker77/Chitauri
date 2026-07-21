// FILE: theme.logic.ts
// Purpose: Owns the app theme model, legacy share-string parsing, and derived CSS token math.
// Layer: Web appearance domain logic
// Exports: Theme types, normalization helpers, import/export utilities, and CSS variable builders.

import { THEME_SEED_CATALOG } from "./theme.seed.generated";
import {
  normalizeFontFamilyCssValue,
  normalizeMonospaceFontFamilyCssValue,
} from "../lib/fontFamily";

export type ThemeVariant = "light" | "dark";
export type ThemeMode = ThemeVariant | "system";
export type WindowMaterial = "opaque" | "translucent";

export interface ThemeFonts {
  ui: string | null;
  code: string | null;
}

export interface ThemeSemanticColors {
  diffAdded: string;
  diffRemoved: string;
  skill: string;
}

export interface ChromeTheme {
  accent: string;
  contrast: number;
  fonts: ThemeFonts;
  ink: string;
  opaqueWindows: boolean;
  semanticColors: ThemeSemanticColors;
  surface: string;
}

export interface ThemePack {
  codeThemeId: string;
  theme: ChromeTheme;
}

export interface ThemeState {
  chromeTheme: ChromeTheme;
  codeThemeId: string;
  variant: ThemeVariant;
}

export interface CodeThemeOption {
  id: string;
  label: string;
}

export interface ThemeSharePayload {
  codeThemeId: string;
  theme: ChromeTheme;
}

export interface ThemeCssVariableBuild {
  material: WindowMaterial;
  variables: Record<string, string>;
}

export interface ThemeDerivedTokens {
  accentBackground: string;
  accentBackgroundActive: string;
  accentBackgroundHover: string;
  border: string;
  borderFocus: string;
  borderHeavy: string;
  borderLight: string;
  buttonPrimaryBackground: string;
  buttonPrimaryBackgroundActive: string;
  buttonPrimaryBackgroundHover: string;
  buttonPrimaryBackgroundInactive: string;
  buttonSecondaryBackground: string;
  buttonSecondaryBackgroundActive: string;
  buttonSecondaryBackgroundHover: string;
  buttonSecondaryBackgroundInactive: string;
  buttonTertiaryBackground: string;
  buttonTertiaryBackgroundActive: string;
  buttonTertiaryBackgroundHover: string;
  controlBackground: string;
  controlBackgroundOpaque: string;
  elevatedPrimary: string;
  elevatedPrimaryOpaque: string;
  elevatedSecondary: string;
  elevatedSecondaryOpaque: string;
  iconAccent: string;
  iconPrimary: string;
  iconSecondary: string;
  iconTertiary: string;
  simpleScrim: string;
  textAccent: string;
  textButtonPrimary: string;
  textButtonSecondary: string;
  textButtonTertiary: string;
  textForeground: string;
  textForegroundSecondary: string;
  textForegroundTertiary: string;
}

export interface ResolvedThemeTokens {
  aliases: Record<string, string>;
  codexVariables: Record<string, string>;
  computed: {
    contrast: number;
    editorBackground: string;
    panel: string;
    surfaceUnder: string;
  };
  derived: ThemeDerivedTokens;
}

type ChromeThemeSeedPatch = Partial<
  Pick<ChromeTheme, "accent" | "contrast" | "ink" | "opaqueWindows" | "surface">
> & {
  fonts?: Partial<ThemeFonts>;
  semanticColors?: Partial<ThemeSemanticColors>;
};

type CodeThemeSeedPatchMetadata = {
  contrast?: true;
  fonts?: Partial<Record<keyof ThemeFonts, true>>;
  opaqueWindows?: true;
};

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

const WHITE: RgbColor = { blue: 255, green: 255, red: 255 };
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const THEME_SHARE_PREFIX = "codex-theme-v1:";
const CONTRAST_CURVE_BELOW_BASELINE = 0.7;
const CONTRAST_CURVE_ABOVE_BASELINE = 2;
// The shell deliberately separates the flat window canvas from the one
// elevated panel layer.
const SURFACE_UNDER_BASE_ALPHA = 0.565;
const SURFACE_UNDER_CONTRAST_STEP = 0.001;
const CANVAS_COLOR = "#090909";
const INFO_COLOR = "#3b82f6";
// "Warning" no longer has its own hue: it collapses onto the danger red so old
// call sites stay legible until they migrate to the semantic tokens.
const WARNING_COLOR = "#e94b4b";
const MUTED_COLOR = "#807f7c";
const FAINT_COLOR = "#585856";
const SUCCESS_FOREGROUND = "#a5d6b7";
const DESTRUCTIVE_FOREGROUND = "#ef9091";
const WARNING_FOREGROUND = "#ef9091";
const TERMINAL_ANSI: { blue: string; cyan: string; magenta: string } = {
  blue: "#75a7e0",
  cyan: "#66b8b0",
  magenta: "#b99ad6",
};
const COMPOSER_SURFACE = "#141414";
const INPUT_SURFACE = "#141414";
const LIGHT_COMPOSER_SURFACE = "#E8E7E2";
const LIGHT_INPUT_SURFACE = "#E8E7E2";
const LIGHT_CANVAS_COLOR = "#F5F4EF";
const CODE_THEME_SEED_PATCH_METADATA: Partial<Record<string, CodeThemeSeedPatchMetadata>> = {
  linear: { fonts: { ui: true }, opaqueWindows: true },
  lobster: { fonts: { ui: true } },
  matrix: { fonts: { code: true, ui: true }, opaqueWindows: true },
  notion: { fonts: { code: true, ui: true }, opaqueWindows: true },
  raycast: { fonts: { code: true, ui: true }, opaqueWindows: true },
  sentry: { fonts: { code: true, ui: true } },
  vercel: { contrast: true, fonts: { code: true, ui: true }, opaqueWindows: true },
  "dp-code": { contrast: true },
};

// Mirror the packaged Codex catalog closely enough that share-string validation
// can preserve the "known theme" behavior.
export const CODE_THEME_OPTIONS: readonly CodeThemeOption[] = [
  { id: "absolutely", label: "Absolutely" },
  { id: "ayu", label: "Ayu" },
  { id: "catppuccin", label: "Catppuccin" },
  { id: "codex", label: "Codex" },
  { id: "dp-code", label: "TeaCode" },
  { id: "dracula", label: "Dracula" },
  { id: "everforest", label: "Everforest" },
  { id: "github", label: "GitHub" },
  { id: "gruvbox", label: "Gruvbox" },
  { id: "linear", label: "Linear" },
  { id: "lobster", label: "Lobster" },
  { id: "material", label: "Material" },
  { id: "matrix", label: "Matrix" },
  { id: "monokai", label: "Monokai" },
  { id: "night-owl", label: "Night Owl" },
  { id: "nord", label: "Nord" },
  { id: "notion", label: "Notion" },
  { id: "one", label: "One" },
  { id: "oscurange", label: "Oscurange" },
  { id: "raycast", label: "Raycast" },
  { id: "rose-pine", label: "Rose Pine" },
  { id: "sentry", label: "Sentry" },
  { id: "solarized", label: "Solarized" },
  { id: "temple", label: "Temple" },
  { id: "tokyo-night", label: "Tokyo Night" },
  { id: "vercel", label: "Vercel" },
  { id: "vscode-plus", label: "VS Code Plus" },
] as const;

export const DEFAULT_CHROME_THEME: ChromeTheme = {
  accent: "#3b82f6",
  contrast: 60,
  fonts: { code: null, ui: null },
  ink: "#e3e2dd",
  opaqueWindows: false,
  semanticColors: {
    diffAdded: "#4cb782",
    diffRemoved: "#e94b4b",
    skill: "#9aa1ad",
  },
  surface: "#141414",
};

export const DEFAULT_LIGHT_CHROME_THEME: ChromeTheme = {
  accent: "#5A7FA8",
  contrast: 60,
  fonts: { code: null, ui: null },
  ink: "#575757",
  opaqueWindows: false,
  semanticColors: {
    diffAdded: "#6E9B5C",
    diffRemoved: "#C25A50",
    skill: "#8A6BAA",
  },
  surface: "#F5F4EF",
};

const LEGACY_DEFAULT_CHROME_THEME: ChromeTheme = {
  accent: "#fb923c",
  contrast: 60,
  fonts: { code: null, ui: null },
  ink: "#f4f4f5",
  opaqueWindows: true,
  semanticColors: {
    diffAdded: "#4ade80",
    diffRemoved: "#f43f5e",
    skill: "#3b82f6",
  },
  surface: "#18181b",
};

export const DEFAULT_THEME_STATE: ThemeState = {
  chromeTheme: DEFAULT_CHROME_THEME,
  codeThemeId: "codex",
  variant: "dark",
};

// ─── Theme catalog helpers ────────────────────────────────────────────────

export function getThemeSharePrefix(): string {
  return THEME_SHARE_PREFIX;
}

export function isCodeThemeAvailable(codeThemeId: string): boolean {
  const normalizedCodeThemeId = codeThemeId.trim().toLowerCase();
  return CODE_THEME_OPTIONS.some((option) => option.id === normalizedCodeThemeId);
}

export function normalizeCodeThemeId(
  codeThemeId: unknown,
  fallback = DEFAULT_THEME_STATE.codeThemeId,
): string {
  const normalizedCodeThemeId =
    typeof codeThemeId === "string" ? codeThemeId.trim().toLowerCase() : "";
  return isCodeThemeAvailable(normalizedCodeThemeId) ? normalizedCodeThemeId : fallback;
}

// ─── Theme normalization ──────────────────────────────────────────────────

export function normalizeThemeFonts(value: unknown): ThemeFonts {
  const fonts = isRecord(value) ? value : {};
  return {
    code: normalizeFontSelection(fonts.code),
    ui: normalizeFontSelection(fonts.ui),
  };
}

export function normalizeSemanticColors(
  value: unknown,
  fallback: ThemeSemanticColors,
): ThemeSemanticColors {
  const semanticColors = isRecord(value) ? value : {};
  return {
    diffAdded: normalizeHexColor(semanticColors.diffAdded) ?? fallback.diffAdded,
    diffRemoved: normalizeHexColor(semanticColors.diffRemoved) ?? fallback.diffRemoved,
    skill: normalizeHexColor(semanticColors.skill) ?? fallback.skill,
  };
}

export function normalizeChromeTheme(value: unknown): ChromeTheme {
  const fallback = DEFAULT_CHROME_THEME;
  const theme = isRecord(value) ? value : {};

  return {
    accent: normalizeHexColor(theme.accent) ?? fallback.accent,
    contrast: normalizeStoredContrast(theme.contrast, fallback.contrast),
    fonts: normalizeThemeFonts(theme.fonts),
    ink: normalizeHexColor(theme.ink) ?? fallback.ink,
    opaqueWindows:
      theme.opaqueWindows === true || theme.opaqueWindows === false
        ? theme.opaqueWindows
        : fallback.opaqueWindows,
    semanticColors: normalizeSemanticColors(theme.semanticColors, fallback.semanticColors),
    surface: normalizeHexColor(theme.surface) ?? fallback.surface,
  };
}

export function normalizeThemePack(value: unknown): ThemePack {
  const pack = isRecord(value) ? value : {};
  return {
    codeThemeId: normalizeCodeThemeId(pack.codeThemeId),
    theme: normalizeChromeTheme(pack.theme),
  };
}

function haveSameChromePalette(left: ChromeTheme, right: ChromeTheme): boolean {
  return (
    left.accent === right.accent &&
    left.contrast === right.contrast &&
    left.ink === right.ink &&
    left.semanticColors.diffAdded === right.semanticColors.diffAdded &&
    left.semanticColors.diffRemoved === right.semanticColors.diffRemoved &&
    left.semanticColors.skill === right.semanticColors.skill &&
    left.surface === right.surface
  );
}

/** Accents retired by the monochrome design system (Design.md §2): orange, coral, gold. */
const LEGACY_ACCENT_COLORS: ReadonlySet<string> = new Set(["#fb923c", "#d97757", "#a96f35"]);

function migrateLegacyDefaultChromeTheme(theme: ChromeTheme): ChromeTheme {
  if (haveSameChromePalette(theme, LEGACY_DEFAULT_CHROME_THEME)) {
    return {
      ...DEFAULT_CHROME_THEME,
      fonts: theme.fonts,
      opaqueWindows: theme.opaqueWindows,
    };
  }

  // Stored themes that diverged from the legacy default (contrast tweaks, custom
  // semantic colors) still carry the retired accent, which paints focus rings and
  // selection. Migrate the accent alone and keep the rest of the customization.
  if (LEGACY_ACCENT_COLORS.has(theme.accent)) {
    return {
      ...theme,
      accent: DEFAULT_CHROME_THEME.accent,
    };
  }

  return theme;
}

export function normalizeThemeState(value: unknown): ThemeState {
  const state = isRecord(value) ? value : {};
  const chromeThemes = isRecord(state.chromeThemes) ? state.chromeThemes : {};
  const codeThemeIds = isRecord(state.codeThemeIds) ? state.codeThemeIds : {};
  const packs = isRecord(state.packs) ? state.packs : {};
  const legacyDarkPack = normalizeThemePack(packs.dark);

  // Prefer the current-format fields; fall back through the legacy per-variant
  // shapes (`chromeThemes`/`codeThemeIds`, then the even older `packs` shape),
  // always reading the dark side and ignoring anything light-specific.
  const chromeTheme = isRecord(state.chromeTheme)
    ? normalizeChromeTheme(state.chromeTheme)
    : isRecord(chromeThemes.dark)
      ? normalizeChromeTheme(chromeThemes.dark)
      : isRecord(packs.dark)
        ? legacyDarkPack.theme
        : DEFAULT_THEME_STATE.chromeTheme;

  const codeThemeId = normalizeCodeThemeId(
    state.codeThemeId ?? codeThemeIds.dark ?? legacyDarkPack.codeThemeId,
  );

  const variant: ThemeVariant =
    state.variant === "light" || state.variant === "dark"
      ? state.variant
      : DEFAULT_THEME_STATE.variant;

  return { chromeTheme, codeThemeId, variant };
}

export function parseStoredThemeState(rawValue: string | null | undefined): ThemeState {
  if (!rawValue) {
    return DEFAULT_THEME_STATE;
  }
  // Very old storage held a bare mode string ("light" | "dark" | "system")
  // instead of JSON. Appearance is dark-only now, so just fall back to default.
  if (rawValue === "light" || rawValue === "dark" || rawValue === "system") {
    return DEFAULT_THEME_STATE;
  }

  try {
    const storedState = normalizeThemeState(JSON.parse(rawValue));
    return {
      ...storedState,
      chromeTheme: migrateLegacyDefaultChromeTheme(storedState.chromeTheme),
    };
  } catch {
    return DEFAULT_THEME_STATE;
  }
}

export function serializeThemeState(state: ThemeState): string {
  return JSON.stringify(state);
}

// ─── Share-string import / export ─────────────────────────────────────────

export function createThemeShareString(pack: ThemePack): string {
  return `${THEME_SHARE_PREFIX}${JSON.stringify({
    codeThemeId: pack.codeThemeId,
    theme: pack.theme,
  })}`;
}

export function parseThemeShareString(rawValue: string): ThemeSharePayload {
  const value = rawValue.trim();
  if (!value.startsWith(THEME_SHARE_PREFIX)) {
    throw new Error("Theme share string must start with codex-theme-v1:");
  }

  const payloadText = value.slice(THEME_SHARE_PREFIX.length);
  const jsonText = payloadText.startsWith("{") ? payloadText : decodeURIComponent(payloadText);
  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    throw new Error("Theme share string does not contain valid JSON.");
  }

  const themeShare = parseThemeSharePayload(payload);
  if (!isCodeThemeAvailable(themeShare.codeThemeId)) {
    throw new Error(`Code theme "${themeShare.codeThemeId}" is not available.`);
  }

  return {
    codeThemeId: themeShare.codeThemeId,
    theme: normalizeChromeTheme(themeShare.theme),
  };
}

export function canParseThemeShareString(value: string): boolean {
  try {
    parseThemeShareString(value);
    return true;
  } catch {
    return false;
  }
}

export function updateThemePackFromShareString(state: ThemeState, value: string): ThemeState {
  const payload = parseThemeShareString(value);
  return {
    ...state,
    chromeTheme: payload.theme,
    codeThemeId: payload.codeThemeId,
  };
}

// ─── Granular pack mutators ───────────────────────────────────────────────

export function updateChromeTheme(state: ThemeState, patch: Partial<ChromeTheme>): ThemeState {
  const previousTheme = state.chromeTheme;
  const nextPatch: ChromeThemeSeedPatch = { ...patch };
  if (patch.fonts) {
    nextPatch.fonts = patch.fonts;
  }
  if (patch.semanticColors) {
    nextPatch.semanticColors = patch.semanticColors;
  }
  return {
    ...state,
    chromeTheme: normalizeChromeTheme(mergeThemeSeedPatch(previousTheme, nextPatch)),
  };
}

export function setThemeCodeThemeId(state: ThemeState, codeThemeId: string): ThemeState {
  const normalized = normalizeCodeThemeId(codeThemeId);
  const previousTheme = resolveThemePack(state).theme;
  const nextTheme = normalizeChromeTheme(
    mergeThemeSeedPatch(previousTheme, getCodeThemeSeedPatch(normalized)),
  );
  return {
    ...state,
    chromeTheme: nextTheme,
    codeThemeId: normalized,
  };
}

export function getCodeThemeSeed(codeThemeId: string): ChromeTheme {
  const fallback = DEFAULT_CHROME_THEME;
  if (codeThemeId === "codex") {
    return fallback;
  }
  const themeSeed = THEME_SEED_CATALOG[codeThemeId];
  return themeSeed ? normalizeChromeTheme(themeSeed) : fallback;
}

export function getCodeThemeSeedPatch(codeThemeId: string): ChromeThemeSeedPatch {
  const themeSeed = THEME_SEED_CATALOG[codeThemeId];
  if (!themeSeed) {
    return {};
  }

  const normalizedSeed = normalizeChromeTheme(themeSeed);
  const metadata = CODE_THEME_SEED_PATCH_METADATA[codeThemeId];
  const patch: ChromeThemeSeedPatch = {
    accent: normalizedSeed.accent,
    ink: normalizedSeed.ink,
    semanticColors: normalizedSeed.semanticColors,
    surface: normalizedSeed.surface,
  };

  if (metadata?.contrast) {
    patch.contrast = normalizedSeed.contrast;
  }

  if (metadata?.opaqueWindows) {
    patch.opaqueWindows = normalizedSeed.opaqueWindows;
  }

  if (metadata?.fonts) {
    const fontPatch: Partial<ThemeFonts> = {};
    if (metadata.fonts.code) {
      fontPatch.code = normalizedSeed.fonts.code;
    }
    if (metadata.fonts.ui) {
      fontPatch.ui = normalizedSeed.fonts.ui;
    }
    if (Object.keys(fontPatch).length > 0) {
      patch.fonts = fontPatch;
    }
  }

  return patch;
}

function mergeThemeSeedPatch(
  currentTheme: ChromeTheme,
  seedPatch: ChromeThemeSeedPatch,
): ChromeThemeSeedPatch {
  return {
    ...currentTheme,
    ...seedPatch,
    fonts: seedPatch.fonts ? { ...currentTheme.fonts, ...seedPatch.fonts } : currentTheme.fonts,
    semanticColors: seedPatch.semanticColors
      ? { ...currentTheme.semanticColors, ...seedPatch.semanticColors }
      : currentTheme.semanticColors,
  };
}

export function setThemeFonts(state: ThemeState, patch: Partial<ThemeFonts>): ThemeState {
  const previousTheme = state.chromeTheme;
  return {
    ...state,
    chromeTheme: normalizeChromeTheme({
      ...previousTheme,
      fonts: { ...previousTheme.fonts, ...patch },
    }),
  };
}

export function resetTheme(state: ThemeState): ThemeState {
  return {
    ...state,
    chromeTheme: DEFAULT_THEME_STATE.chromeTheme,
    codeThemeId: DEFAULT_THEME_STATE.codeThemeId,
  };
}

export function resolveThemePack(state: ThemeState): ThemePack {
  return {
    codeThemeId: normalizeCodeThemeId(state.codeThemeId),
    theme: normalizeChromeTheme(state.chromeTheme),
  };
}

/**
 * The chrome palette is stored once and shared by both variants, so a state that
 * still carries a shipped default must be flipped to the sibling default that
 * matches the active variant. Without this, light mode renders the dark palette's
 * near-white ink over a washed-out dark surface. Custom palettes are left alone —
 * the derivation already has a non-default branch for them.
 */
export function resolveThemePackForVariant(state: ThemeState): ThemePack {
  const pack = resolveThemePack(state);
  const wantsLight = state.variant === "light";
  const sibling = wantsLight ? DEFAULT_CHROME_THEME : DEFAULT_LIGHT_CHROME_THEME;
  if (!haveSameChromePalette(pack.theme, sibling)) {
    return pack;
  }
  const target = wantsLight ? DEFAULT_LIGHT_CHROME_THEME : DEFAULT_CHROME_THEME;
  return {
    ...pack,
    theme: {
      ...target,
      fonts: pack.theme.fonts,
      opaqueWindows: pack.theme.opaqueWindows,
    },
  };
}

export function areThemePacksEqual(left: ThemePack, right: ThemePack): boolean {
  return (
    left.codeThemeId === right.codeThemeId &&
    left.theme.accent === right.theme.accent &&
    left.theme.contrast === right.theme.contrast &&
    left.theme.fonts.code === right.theme.fonts.code &&
    left.theme.fonts.ui === right.theme.fonts.ui &&
    left.theme.ink === right.theme.ink &&
    left.theme.opaqueWindows === right.theme.opaqueWindows &&
    left.theme.semanticColors.diffAdded === right.theme.semanticColors.diffAdded &&
    left.theme.semanticColors.diffRemoved === right.theme.semanticColors.diffRemoved &&
    left.theme.semanticColors.skill === right.theme.semanticColors.skill &&
    left.theme.surface === right.theme.surface
  );
}

// ─── Theme derivation ─────────────────────────────────────────────────────

export function buildThemeCssVariables(
  pack: ThemePack,
  options?: { electron?: boolean; isMac?: boolean; variant?: ThemeVariant },
): ThemeCssVariableBuild {
  const variant = options?.variant ?? "dark";
  const resolvedTokens = buildResolvedThemeTokens(pack, variant);
  const codexVariables = resolvedTokens.codexVariables;
  const readCodexVariable = (name: string) => getRequiredVariable(codexVariables, name);
  // On macOS the window is created over an "under-window" vibrancy material, so a
  // non-opaque theme lets the shell tint that glass instead of painting over it.
  const material: WindowMaterial =
    options?.electron === true && options?.isMac === true && !pack.theme.opaqueWindows
      ? "translucent"
      : "opaque";
  const isDefaultDarkTheme = haveSameChromePalette(pack.theme, DEFAULT_CHROME_THEME);
  const isDefaultLightTheme = haveSameChromePalette(pack.theme, DEFAULT_LIGHT_CHROME_THEME);
  const isDefaultTheme = isDefaultDarkTheme || isDefaultLightTheme;
  // The sidebar is the single persistent panel layer; the main transcript uses
  // the darker under-surface directly as its flat canvas.
  const sidebarSurface = readCodexVariable("--color-background-surface");
  const settingsSurface = readCodexVariable("--color-background-surface-under");
  const composerSurface = isDefaultTheme
    ? variant === "light"
      ? LIGHT_COMPOSER_SURFACE
      : COMPOSER_SURFACE
    : mixHex(pack.theme.surface, resolvedTokens.computed.surfaceUnder, 0.23);
  const composerPickerMenuSurface = sidebarSurface;
  const composerFocusBorder = buildComposerFocusBorder(
    pack,
    resolvedTokens.computed.panel,
    variant,
  );
  // Shared surface for the user message bubble and fenced code blocks so both
  // read as the same "input/source" affordance inside the transcript. Sourced
  // from the user-message token so code blocks pick up the bubble's color.
  const chatCodeSurface = isDefaultTheme
    ? variant === "light"
      ? LIGHT_INPUT_SURFACE
      : INPUT_SURFACE
    : mixHex(pack.theme.surface, pack.theme.ink, 0.04);
  const appVariables: Record<string, string> = {
    "--accent": pack.theme.accent,
    "--accent-foreground": readCodexVariable("--color-text-foreground"),
    "--app-composer-focus-border": composerFocusBorder,
    // Composer and picker surfaces stay opaque in every runtime.
    "--app-composer-backdrop-filter": "none",
    "--app-composer-picker-backdrop-filter": "none",
    "--app-composer-picker-surface": composerPickerMenuSurface,
    "--app-chat-code-surface": chatCodeSurface,
    "--app-user-message-background": chatCodeSurface,
    "--app-sidebar-backdrop-filter": "none",
    // Settings shares the flat canvas while its grouping cards use --panel.
    "--app-settings-backdrop-filter": "none",
    "--app-sidebar-shadow": "none",
    "--app-sidebar-surface": sidebarSurface,
    // Always opaque so the settings page matches the chat canvas exactly.
    "--app-settings-surface": settingsSurface,
    "--background": readCodexVariable("--color-background-surface-under"),
    "--border": readCodexVariable("--color-border"),
    "--card": readCodexVariable("--color-background-panel"),
    "--card-foreground": readCodexVariable("--color-text-foreground"),
    "--composer-surface": composerSurface,
    "--destructive": pack.theme.semanticColors.diffRemoved,
    "--destructive-foreground": isDefaultTheme
      ? variant === "light"
        ? pack.theme.semanticColors.diffRemoved
        : DESTRUCTIVE_FOREGROUND
      : pack.theme.semanticColors.diffRemoved,
    "--foreground": readCodexVariable("--color-text-foreground"),
    "--faint": readCodexVariable("--color-text-foreground-tertiary"),
    "--hover": readCodexVariable("--color-background-button-secondary-hover"),
    "--info": INFO_COLOR,
    "--info-foreground": INFO_COLOR,
    "--input": readCodexVariable("--color-background-control-opaque"),
    "--muted": readCodexVariable("--color-background-elevated-secondary"),
    "--muted-foreground": readCodexVariable("--color-text-foreground-secondary"),
    "--panel": sidebarSurface,
    "--panel-border": readCodexVariable("--color-border"),
    "--popover": sidebarSurface,
    "--popover-foreground": readCodexVariable("--color-text-foreground"),
    "--primary": readCodexVariable("--color-background-button-primary"),
    "--primary-foreground": readCodexVariable("--color-text-button-primary"),
    "--ring": readCodexVariable("--color-border-focus"),
    "--secondary": readCodexVariable("--color-background-button-secondary"),
    "--secondary-foreground": readCodexVariable("--color-text-button-secondary"),
    "--selected": readCodexVariable("--color-background-button-secondary-active"),
    "--sidebar": readCodexVariable("--color-background-surface"),
    "--sidebar-accent": readCodexVariable("--color-background-button-secondary-hover"),
    "--sidebar-accent-active": readCodexVariable("--color-background-button-secondary-active"),
    "--sidebar-accent-foreground": readCodexVariable("--color-text-foreground"),
    "--sidebar-border": readCodexVariable("--color-border"),
    "--sidebar-foreground": readCodexVariable("--color-text-foreground"),
    "--success": pack.theme.semanticColors.diffAdded,
    "--success-foreground": isDefaultTheme
      ? variant === "light"
        ? pack.theme.semanticColors.diffAdded
        : SUCCESS_FOREGROUND
      : pack.theme.semanticColors.diffAdded,
    "--theme-font-code-family": normalizeMonospaceFontFamilyCssValue(pack.theme.fonts.code) ?? "",
    "--theme-font-ui-family": normalizeFontFamilyCssValue(pack.theme.fonts.ui) ?? "",
    "--warning": WARNING_COLOR,
    "--warning-foreground": isDefaultTheme ? WARNING_FOREGROUND : WARNING_COLOR,
    "--well": composerSurface,
  };

  return {
    material,
    variables: {
      ...codexVariables,
      ...resolvedTokens.aliases,
      ...appVariables,
    },
  };
}

export function buildResolvedThemeTokens(
  pack: ThemePack,
  variant: ThemeVariant = "dark",
): ResolvedThemeTokens {
  const computedTheme = buildComputedTheme(pack.theme, variant);
  const derived = buildDerivedTokens(computedTheme, variant);
  const panel = buildPanelBackground(computedTheme);
  const codexVariables = buildCodexCssVariables(computedTheme, derived, panel, variant);

  return {
    aliases: buildThemeTokenAliases(codexVariables),
    codexVariables,
    computed: {
      contrast: computedTheme.contrast,
      editorBackground: formatOpaqueRgb(computedTheme.editorBackground),
      panel,
      surfaceUnder: computedTheme.surfaceUnder,
    },
    derived,
  };
}

function buildComputedTheme(theme: ChromeTheme, variant: ThemeVariant = "dark") {
  const contrast = normalizeContrastStrength(theme.contrast);
  const surface = parseHexColor(theme.surface);
  const ink = parseHexColor(theme.ink);

  return {
    accent: parseHexColor(theme.accent),
    contrast,
    editorBackground: variant === "light" ? mixRgb(surface, ink, 0.03) : mixRgb(surface, ink, 0.07),
    ink,
    surface,
    surfaceUnder: buildSurfaceUnder(theme, surface, variant),
    theme,
  };
}

function buildCodexCssVariables(
  theme: ReturnType<typeof buildComputedTheme>,
  derivedTokens: ReturnType<typeof buildDerivedTokens>,
  panelBackground: string,
  variant: ThemeVariant = "dark",
) {
  const isDefaultDarkTheme = haveSameChromePalette(theme.theme, DEFAULT_CHROME_THEME);
  const isDefaultLightTheme = haveSameChromePalette(theme.theme, DEFAULT_LIGHT_CHROME_THEME);
  const isDefaultTheme = isDefaultDarkTheme || isDefaultLightTheme;
  const terminalAnsiGreen = buildTerminalAnsiGreen(theme.theme.semanticColors.diffAdded);

  return {
    "--codex-base-accent": theme.theme.accent,
    "--codex-base-contrast": String(theme.theme.contrast),
    "--codex-base-ink": theme.theme.ink,
    "--codex-base-surface": theme.theme.surface,
    "--color-accent-blue": theme.theme.accent,
    "--color-accent-green": theme.theme.semanticColors.diffAdded,
    "--color-accent-red": theme.theme.semanticColors.diffRemoved,
    "--color-accent-purple": theme.theme.semanticColors.skill,
    "--color-accent-yellow": WARNING_COLOR,
    "--color-background-accent": derivedTokens.accentBackground,
    "--color-background-accent-active": derivedTokens.accentBackgroundActive,
    "--color-background-accent-hover": derivedTokens.accentBackgroundHover,
    "--color-background-button-primary": derivedTokens.buttonPrimaryBackground,
    "--color-background-button-primary-active": derivedTokens.buttonPrimaryBackgroundActive,
    "--color-background-button-primary-hover": derivedTokens.buttonPrimaryBackgroundHover,
    "--color-background-button-primary-inactive": derivedTokens.buttonPrimaryBackgroundInactive,
    "--color-background-button-secondary": derivedTokens.buttonSecondaryBackground,
    "--color-background-button-secondary-active": derivedTokens.buttonSecondaryBackgroundActive,
    "--color-background-button-secondary-hover": derivedTokens.buttonSecondaryBackgroundHover,
    "--color-background-button-secondary-inactive": derivedTokens.buttonSecondaryBackgroundInactive,
    "--color-background-button-tertiary": derivedTokens.buttonTertiaryBackground,
    "--color-background-button-tertiary-active": derivedTokens.buttonTertiaryBackgroundActive,
    "--color-background-button-tertiary-hover": derivedTokens.buttonTertiaryBackgroundHover,
    "--color-background-control": derivedTokens.controlBackground,
    "--color-background-control-opaque": derivedTokens.controlBackgroundOpaque,
    "--color-background-editor-opaque": formatOpaqueRgb(theme.editorBackground),
    "--color-background-elevated-primary": derivedTokens.elevatedPrimary,
    "--color-background-elevated-primary-opaque": derivedTokens.elevatedPrimaryOpaque,
    "--color-background-elevated-secondary": derivedTokens.elevatedSecondary,
    "--color-background-elevated-secondary-opaque": derivedTokens.elevatedSecondaryOpaque,
    "--color-background-panel": panelBackground,
    "--color-background-surface": theme.theme.surface,
    "--color-background-surface-under": theme.surfaceUnder,
    // The user message bubble has always reused the subtle secondary surface
    // (theme ink at ~4% over the background); keep it sourced from there.
    "--color-background-user-message": derivedTokens.buttonSecondaryBackground,
    "--color-border": derivedTokens.border,
    "--color-border-focus": derivedTokens.borderFocus,
    "--color-border-heavy": derivedTokens.borderHeavy,
    "--color-border-light": derivedTokens.borderLight,
    "--color-decoration-added": theme.theme.semanticColors.diffAdded,
    "--color-decoration-deleted": theme.theme.semanticColors.diffRemoved,
    "--color-editor-added": formatRgba(parseHexColor(theme.theme.semanticColors.diffAdded), 0.23),
    "--color-editor-deleted": formatRgba(
      parseHexColor(theme.theme.semanticColors.diffRemoved),
      0.23,
    ),
    "--color-icon-accent": derivedTokens.iconAccent,
    "--color-icon-primary": derivedTokens.iconPrimary,
    "--color-icon-secondary": derivedTokens.iconSecondary,
    "--color-icon-tertiary": derivedTokens.iconTertiary,
    "--color-simple-scrim": derivedTokens.simpleScrim,
    "--color-text-accent": derivedTokens.textAccent,
    "--color-text-button-primary": derivedTokens.textButtonPrimary,
    "--color-text-button-secondary": derivedTokens.textButtonSecondary,
    "--color-text-button-tertiary": derivedTokens.textButtonTertiary,
    "--color-text-foreground": derivedTokens.textForeground,
    "--color-text-foreground-secondary": derivedTokens.textForegroundSecondary,
    "--color-text-foreground-tertiary": derivedTokens.textForegroundTertiary,
    "--vscode-terminal-ansiBlack": derivedTokens.textForegroundTertiary,
    "--vscode-terminal-ansiBlue": isDefaultTheme ? TERMINAL_ANSI.blue : theme.theme.accent,
    "--vscode-terminal-ansiBrightBlack": derivedTokens.textForegroundSecondary,
    "--vscode-terminal-ansiBrightBlue": isDefaultTheme ? TERMINAL_ANSI.blue : theme.theme.accent,
    "--vscode-terminal-ansiBrightCyan": isDefaultTheme ? TERMINAL_ANSI.cyan : theme.theme.accent,
    "--vscode-terminal-ansiBrightGreen": terminalAnsiGreen,
    "--vscode-terminal-ansiBrightMagenta": isDefaultTheme
      ? TERMINAL_ANSI.magenta
      : theme.theme.semanticColors.skill,
    "--vscode-terminal-ansiBrightRed": theme.theme.semanticColors.diffRemoved,
    "--vscode-terminal-ansiBrightWhite": derivedTokens.textForeground,
    "--vscode-terminal-ansiBrightYellow": WARNING_COLOR,
    "--vscode-terminal-ansiCyan": isDefaultTheme ? TERMINAL_ANSI.cyan : theme.theme.accent,
    "--vscode-terminal-ansiGreen": terminalAnsiGreen,
    "--vscode-terminal-ansiMagenta": isDefaultTheme
      ? TERMINAL_ANSI.magenta
      : theme.theme.semanticColors.skill,
    "--vscode-terminal-ansiRed": theme.theme.semanticColors.diffRemoved,
    "--vscode-terminal-ansiWhite": derivedTokens.textForeground,
    "--vscode-terminal-ansiYellow": WARNING_COLOR,
    "--vscode-terminal-background": theme.theme.surface,
    "--vscode-terminal-border": derivedTokens.border,
    "--vscode-terminal-foreground": derivedTokens.textForeground,
  };
}

function buildTerminalAnsiGreen(diffAddedColor: string): string {
  // Terminal success green should read calmer than diff decorations on a white shell.
  return mixHex(diffAddedColor, "#000000", 0.18);
}

function buildThemeTokenAliases(codexVariables: Record<string, string>): Record<string, string> {
  const readCodexVariable = (name: string) => getRequiredVariable(codexVariables, name);

  return {
    "--color-token-badge-background": readCodexVariable("--color-background-accent"),
    "--color-token-badge-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-border": readCodexVariable("--color-border"),
    "--color-token-border-default": readCodexVariable("--color-border"),
    "--color-token-border-heavy": readCodexVariable("--color-border-heavy"),
    "--color-token-border-light": readCodexVariable("--color-border-light"),
    "--color-token-button-background": readCodexVariable("--color-background-button-primary"),
    "--color-token-button-border": readCodexVariable("--color-border"),
    "--color-token-button-foreground": readCodexVariable("--color-text-button-primary"),
    "--color-token-button-secondary-hover-background": readCodexVariable(
      "--color-background-button-secondary-hover",
    ),
    "--color-token-checkbox-active-background": readCodexVariable(
      "--color-background-accent-hover",
    ),
    "--color-token-checkbox-active-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-description-foreground": readCodexVariable("--color-text-foreground-secondary"),
    "--color-token-disabled-foreground": readCodexVariable("--color-text-foreground-tertiary"),
    "--color-token-dropdown-background": readCodexVariable("--color-background-control-opaque"),
    "--color-token-focus-border": readCodexVariable("--color-border-focus"),
    "--color-token-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-input-background": readCodexVariable("--color-background-control"),
    "--color-token-input-border": readCodexVariable("--color-border"),
    "--color-token-input-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-input-placeholder-foreground": readCodexVariable(
      "--color-text-foreground-tertiary",
    ),
    "--color-token-link": readCodexVariable("--color-text-accent"),
    "--color-token-list-active-selection-background": readCodexVariable(
      "--color-background-button-secondary",
    ),
    "--color-token-list-active-selection-foreground": readCodexVariable("--color-text-foreground"),
    "--color-token-list-active-selection-icon-foreground":
      readCodexVariable("--color-icon-primary"),
    "--color-token-list-hover-background": readCodexVariable(
      "--color-background-button-secondary-hover",
    ),
    "--color-token-main-surface-primary": readCodexVariable("--color-background-surface"),
    "--color-token-menu-background": readCodexVariable("--color-background-elevated-primary"),
    "--color-token-menu-border": readCodexVariable("--color-border"),
    "--color-token-progress-bar-background": readCodexVariable("--color-background-accent"),
    "--color-token-radio-active-foreground": readCodexVariable("--color-icon-accent"),
    "--color-token-scrollbar-slider-active-background": readCodexVariable("--color-border-heavy"),
    "--color-token-scrollbar-slider-background": readCodexVariable("--color-border-light"),
    "--color-token-scrollbar-slider-hover-background": readCodexVariable("--color-border"),
    "--color-token-side-bar-background": readCodexVariable("--color-background-surface"),
    "--color-token-terminal-ansi-black": readCodexVariable("--vscode-terminal-ansiBlack"),
    "--color-token-terminal-ansi-blue": readCodexVariable("--vscode-terminal-ansiBlue"),
    "--color-token-terminal-ansi-bright-black": readCodexVariable(
      "--vscode-terminal-ansiBrightBlack",
    ),
    "--color-token-terminal-ansi-bright-blue": readCodexVariable(
      "--vscode-terminal-ansiBrightBlue",
    ),
    "--color-token-terminal-ansi-bright-cyan": readCodexVariable(
      "--vscode-terminal-ansiBrightCyan",
    ),
    "--color-token-terminal-ansi-bright-green": readCodexVariable(
      "--vscode-terminal-ansiBrightGreen",
    ),
    "--color-token-terminal-ansi-bright-magenta": readCodexVariable(
      "--vscode-terminal-ansiBrightMagenta",
    ),
    "--color-token-terminal-ansi-bright-red": readCodexVariable("--vscode-terminal-ansiBrightRed"),
    "--color-token-terminal-ansi-bright-white": readCodexVariable(
      "--vscode-terminal-ansiBrightWhite",
    ),
    "--color-token-terminal-ansi-bright-yellow": readCodexVariable(
      "--vscode-terminal-ansiBrightYellow",
    ),
    "--color-token-terminal-ansi-cyan": readCodexVariable("--vscode-terminal-ansiCyan"),
    "--color-token-terminal-ansi-green": readCodexVariable("--vscode-terminal-ansiGreen"),
    "--color-token-terminal-ansi-magenta": readCodexVariable("--vscode-terminal-ansiMagenta"),
    "--color-token-terminal-ansi-red": readCodexVariable("--vscode-terminal-ansiRed"),
    "--color-token-terminal-ansi-white": readCodexVariable("--vscode-terminal-ansiWhite"),
    "--color-token-terminal-ansi-yellow": readCodexVariable("--vscode-terminal-ansiYellow"),
    "--color-token-terminal-background": readCodexVariable("--vscode-terminal-background"),
    "--color-token-terminal-border": readCodexVariable("--vscode-terminal-border"),
    "--color-token-terminal-foreground": readCodexVariable("--vscode-terminal-foreground"),
    "--color-token-text-code-block-background": readCodexVariable(
      "--color-background-elevated-secondary-opaque",
    ),
    "--color-token-text-link-active-foreground": readCodexVariable("--color-text-accent"),
    "--color-token-text-link-foreground": readCodexVariable("--color-text-accent"),
    "--color-token-text-primary": readCodexVariable("--color-text-foreground"),
    "--color-token-text-secondary": readCodexVariable("--color-text-foreground-secondary"),
    "--color-token-text-tertiary": readCodexVariable("--color-text-foreground-tertiary"),
    "--color-token-toolbar-hover-background": readCodexVariable(
      "--color-background-button-tertiary-hover",
    ),
    "--color-token-editor-background": readCodexVariable("--color-background-editor-opaque"),
    "--color-token-editor-foreground": readCodexVariable("--color-text-foreground"),
  };
}

function getRequiredVariable(variables: Record<string, string>, name: string): string {
  const value = variables[name];
  if (typeof value !== "string") {
    throw new Error(`Missing required theme variable: ${name}`);
  }
  return value;
}

function buildDerivedTokens(
  theme: ReturnType<typeof buildComputedTheme>,
  variant: ThemeVariant = "dark",
) {
  if (variant === "light") {
    return buildLightDerivedTokens(theme);
  }
  // Dark chrome uses one restrained panel layer over a flat canvas.
  const isDefaultTheme = haveSameChromePalette(theme.theme, DEFAULT_CHROME_THEME);
  const quietInk = isDefaultTheme ? WHITE : theme.ink;
  const controlBase = mixRgb(theme.surface, theme.ink, 0.06 + theme.contrast * 0.05);
  const elevatedPrimaryBase = mixRgb(theme.surface, theme.ink, 0.08 + theme.contrast * 0.08);

  return {
    accentBackground: mixHex("#000000", theme.theme.accent, 0.2 + theme.contrast * 0.08),
    accentBackgroundActive: mixHex("#000000", theme.theme.accent, 0.22 + theme.contrast * 0.12),
    accentBackgroundHover: mixHex("#000000", theme.theme.accent, 0.21 + theme.contrast * 0.1),
    border: formatRgba(WHITE, 0.05 + theme.contrast / 30),
    borderFocus: theme.theme.accent,
    borderHeavy: formatRgba(WHITE, 0.09 + theme.contrast * 0.05),
    borderLight: formatRgba(WHITE, 0.04 + theme.contrast * 0.02),
    // High-contrast primary actions stay white-on-dark so the main action reads
    // clearly without adding glow or depth.
    buttonPrimaryBackground: theme.theme.ink,
    buttonPrimaryBackgroundActive: formatRgba(theme.ink, 0.07 + theme.contrast * 0.05),
    buttonPrimaryBackgroundHover: formatRgba(theme.ink, 0.04 + theme.contrast * 0.03),
    buttonPrimaryBackgroundInactive: formatRgba(theme.ink, 0.02 + theme.contrast * 0.02),
    buttonSecondaryBackground: formatRgba(quietInk, 0.04),
    buttonSecondaryBackgroundActive: formatRgba(quietInk, 0.08),
    buttonSecondaryBackgroundHover: formatRgba(quietInk, 0.05),
    buttonSecondaryBackgroundInactive: formatRgba(quietInk, 0.02 + theme.contrast * 0.03),
    buttonTertiaryBackground: formatRgba(quietInk, 0.02 + theme.contrast * 0.015),
    buttonTertiaryBackgroundActive: formatRgba(quietInk, 0.07 + theme.contrast * 0.05),
    buttonTertiaryBackgroundHover: formatRgba(quietInk, 0.05 + theme.contrast * 0.03),
    controlBackground: formatRgba(controlBase, 0.96),
    controlBackgroundOpaque: formatOpaqueRgb(controlBase),
    elevatedPrimary: formatRgba(elevatedPrimaryBase, 0.96),
    elevatedPrimaryOpaque: formatOpaqueRgb(elevatedPrimaryBase),
    elevatedSecondary: formatRgba(quietInk, 0.02 + theme.contrast * 0.02),
    elevatedSecondaryOpaque: mixHex(
      theme.theme.surface,
      theme.theme.ink,
      0.04 + theme.contrast * 0.05,
    ),
    iconAccent: theme.theme.accent,
    iconPrimary: formatRgba(theme.ink, 0.82 + theme.contrast * 0.14),
    iconSecondary: isDefaultTheme ? MUTED_COLOR : formatRgba(theme.ink, 0.66),
    iconTertiary: isDefaultTheme ? FAINT_COLOR : formatRgba(theme.ink, 0.44),
    simpleScrim: formatRgba(theme.ink, 0.08 + theme.contrast * 0.04),
    textAccent: theme.theme.accent,
    textButtonPrimary: theme.theme.surface,
    textButtonSecondary: mixHex(theme.theme.ink, theme.theme.surface, 0.7 + theme.contrast * 0.1),
    textButtonTertiary: isDefaultTheme
      ? FAINT_COLOR
      : formatRgba(theme.ink, 0.45 + theme.contrast * 0.1),
    textForeground: theme.theme.ink,
    textForegroundSecondary: isDefaultTheme ? MUTED_COLOR : formatRgba(theme.ink, 0.66),
    textForegroundTertiary: isDefaultTheme ? FAINT_COLOR : formatRgba(theme.ink, 0.44),
  };
}

function buildLightDerivedTokens(theme: ReturnType<typeof buildComputedTheme>): ThemeDerivedTokens {
  const isDefaultTheme = haveSameChromePalette(theme.theme, DEFAULT_LIGHT_CHROME_THEME);
  const darkInk = isDefaultTheme ? parseHexColor("#575757") : theme.ink;
  const surface = theme.surface;
  const BLACK = { blue: 0, green: 0, red: 0 };
  const controlBase = mixRgb(surface, theme.ink, 0.04 + theme.contrast * 0.03);
  const elevatedPrimaryBase = mixRgb(surface, theme.ink, 0.06 + theme.contrast * 0.06);

  return {
    accentBackground: mixHex("#ffffff", theme.theme.accent, 0.12 + theme.contrast * 0.06),
    accentBackgroundActive: mixHex("#ffffff", theme.theme.accent, 0.14 + theme.contrast * 0.08),
    accentBackgroundHover: mixHex("#ffffff", theme.theme.accent, 0.13 + theme.contrast * 0.07),
    border: formatRgba(BLACK, 0.08 + theme.contrast / 40),
    borderFocus: theme.theme.accent,
    borderHeavy: formatRgba(BLACK, 0.12 + theme.contrast * 0.04),
    borderLight: formatRgba(BLACK, 0.05 + theme.contrast * 0.02),
    buttonPrimaryBackground: theme.theme.ink,
    buttonPrimaryBackgroundActive: formatRgba(theme.ink, 0.12 + theme.contrast * 0.06),
    buttonPrimaryBackgroundHover: formatRgba(theme.ink, 0.08 + theme.contrast * 0.04),
    buttonPrimaryBackgroundInactive: formatRgba(theme.ink, 0.04 + theme.contrast * 0.03),
    buttonSecondaryBackground: formatRgba(darkInk, 0.05),
    buttonSecondaryBackgroundActive: formatRgba(darkInk, 0.1),
    buttonSecondaryBackgroundHover: formatRgba(darkInk, 0.07),
    buttonSecondaryBackgroundInactive: formatRgba(darkInk, 0.03 + theme.contrast * 0.02),
    buttonTertiaryBackground: formatRgba(darkInk, 0.03 + theme.contrast * 0.01),
    buttonTertiaryBackgroundActive: formatRgba(darkInk, 0.09 + theme.contrast * 0.04),
    buttonTertiaryBackgroundHover: formatRgba(darkInk, 0.06 + theme.contrast * 0.03),
    controlBackground: formatOpaqueRgb(controlBase),
    controlBackgroundOpaque: formatOpaqueRgb(controlBase),
    elevatedPrimary: formatOpaqueRgb(elevatedPrimaryBase),
    elevatedPrimaryOpaque: formatOpaqueRgb(elevatedPrimaryBase),
    elevatedSecondary: formatRgba(darkInk, 0.03 + theme.contrast * 0.02),
    elevatedSecondaryOpaque: mixHex(
      theme.theme.surface,
      theme.theme.ink,
      0.05 + theme.contrast * 0.04,
    ),
    iconAccent: theme.theme.accent,
    iconPrimary: formatRgba(theme.ink, 0.88 + theme.contrast * 0.1),
    iconSecondary: isDefaultTheme ? "#9B9B96" : formatRgba(theme.ink, 0.6),
    iconTertiary: isDefaultTheme ? "#ACACA6" : formatRgba(theme.ink, 0.4),
    simpleScrim: formatRgba(theme.ink, 0.05 + theme.contrast * 0.03),
    textAccent: theme.theme.accent,
    textButtonPrimary: theme.theme.surface,
    textButtonSecondary: mixHex(theme.theme.ink, theme.theme.surface, 0.65 + theme.contrast * 0.1),
    textButtonTertiary: isDefaultTheme
      ? "#757272"
      : formatRgba(theme.ink, 0.5 + theme.contrast * 0.1),
    textForeground: theme.theme.ink,
    textForegroundSecondary: isDefaultTheme ? "#6B6B69" : formatRgba(theme.ink, 0.6),
    textForegroundTertiary: isDefaultTheme ? "#757272" : formatRgba(theme.ink, 0.42),
  };
}

function buildSurfaceUnder(
  theme: ChromeTheme,
  surface: RgbColor,
  variant: ThemeVariant = "dark",
): string {
  if (variant === "light") {
    if (haveSameChromePalette(theme, DEFAULT_LIGHT_CHROME_THEME)) {
      return LIGHT_CANVAS_COLOR;
    }
    const baseline = DEFAULT_LIGHT_CHROME_THEME.contrast;
    const mixAmount =
      SURFACE_UNDER_BASE_ALPHA + (theme.contrast - baseline) * SURFACE_UNDER_CONTRAST_STEP;
    return mixHex(formatHex(surface), "#ffffff", mixAmount);
  }
  if (haveSameChromePalette(theme, DEFAULT_CHROME_THEME)) {
    return CANVAS_COLOR;
  }
  const baseline = DEFAULT_CHROME_THEME.contrast;
  const mixAmount =
    SURFACE_UNDER_BASE_ALPHA + (theme.contrast - baseline) * SURFACE_UNDER_CONTRAST_STEP;
  return mixHex(formatHex(surface), "#000000", mixAmount);
}

function buildPanelBackground(theme: ReturnType<typeof buildComputedTheme>): string {
  // The dark panel is a single flat layer sourced directly from the theme
  // surface; it does not shift with contrast.
  return theme.theme.surface;
}

function buildComposerFocusBorder(
  pack: ThemePack,
  panelBackground: string,
  variant: ThemeVariant = "dark",
): string {
  const panel = parseHexColor(panelBackground);
  const contrast = normalizeContrastStrength(pack.theme.contrast);
  const mixAmount = 0.12 + contrast * 0.06;
  // Lift away from the surface: toward white on dark chrome, toward black on
  // light chrome — a white mix over a light panel would be invisible.
  const lift = variant === "light" ? "#000000" : formatHex(WHITE);
  return mixHex(formatHex(panel), lift, mixAmount);
}

function normalizeContrastStrength(value: number): number {
  const baseline = DEFAULT_CHROME_THEME.contrast;
  const baselineRatio = baseline / 100;
  const curvedValue = value / 100 + ((value - baseline) / 60) * CONTRAST_CURVE_BELOW_BASELINE;

  if (value <= baseline) {
    return curvedValue;
  }

  return baselineRatio + (curvedValue - baselineRatio) * CONTRAST_CURVE_ABOVE_BASELINE;
}

// ─── Parsing helpers ──────────────────────────────────────────────────────

function parseThemeSharePayload(value: unknown): ThemeSharePayload {
  if (!isRecord(value)) {
    throw new Error("Theme share payload must be an object.");
  }

  const codeThemeId = normalizeRequiredString(value.codeThemeId, "Theme share codeThemeId");
  // Legacy payloads carried a `variant` field. Tolerate it if it says "dark";
  // a payload saved from light mode can no longer be imported.
  const variant = value.variant;
  if (variant === "light") {
    throw new Error("This theme was saved from light mode, which TeaCode no longer supports.");
  }
  if (variant !== undefined && variant !== "dark") {
    throw new Error("Theme share variant must be dark.");
  }

  const theme = parseStrictChromeTheme(value.theme);
  return {
    codeThemeId: codeThemeId.toLowerCase(),
    theme,
  };
}

function parseStrictChromeTheme(value: unknown): ChromeTheme {
  if (!isRecord(value)) {
    throw new Error("Theme share theme must be an object.");
  }

  return {
    accent: parseRequiredHexColor(value.accent, "Theme accent"),
    contrast: parseRequiredContrast(value.contrast),
    fonts: parseStrictThemeFonts(value.fonts),
    ink: parseRequiredHexColor(value.ink, "Theme ink"),
    opaqueWindows: parseRequiredBoolean(value.opaqueWindows, "Theme opaqueWindows"),
    semanticColors: parseStrictSemanticColors(value.semanticColors),
    surface: parseRequiredHexColor(value.surface, "Theme surface"),
  };
}

function parseStrictThemeFonts(value: unknown): ThemeFonts {
  if (!isRecord(value)) {
    throw new Error("Theme fonts must be an object.");
  }

  return {
    code: parseNullableString(value.code, "Theme code font"),
    ui: parseNullableString(value.ui, "Theme UI font"),
  };
}

function parseStrictSemanticColors(value: unknown): ThemeSemanticColors {
  if (!isRecord(value)) {
    throw new Error("Theme semanticColors must be an object.");
  }

  return {
    diffAdded: parseRequiredHexColor(value.diffAdded, "Theme diffAdded"),
    diffRemoved: parseRequiredHexColor(value.diffRemoved, "Theme diffRemoved"),
    skill: parseRequiredHexColor(value.skill, "Theme skill"),
  };
}

function parseRequiredContrast(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Theme contrast must be an integer between 0 and 100.");
  }
  return value;
}

function parseRequiredBoolean(value: unknown, label: string): boolean {
  if (value !== true && value !== false) {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function parseNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }
  return normalizeFontSelection(value);
}

function normalizeRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return trimmedValue;
}

function parseRequiredHexColor(value: unknown, label: string): string {
  const normalizedColor = normalizeHexColor(value);
  if (!normalizedColor) {
    throw new Error(`${label} must be a 6-digit hex color.`);
  }
  return normalizedColor;
}

function normalizeStoredContrast(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : fallback;
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmedValue = value.trim();
  return HEX_COLOR_RE.test(trimmedValue) ? trimmedValue.toLowerCase() : null;
}

function normalizeFontSelection(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Color math ───────────────────────────────────────────────────────────

function parseHexColor(value: string): RgbColor {
  const hexValue = value.slice(1);
  return {
    blue: Number.parseInt(hexValue.slice(4, 6), 16),
    green: Number.parseInt(hexValue.slice(2, 4), 16),
    red: Number.parseInt(hexValue.slice(0, 2), 16),
  };
}

function mixHex(from: string, to: string, amount: number): string {
  return formatHex(mixRgb(parseHexColor(from), parseHexColor(to), amount));
}

function mixRgb(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  const clampedAmount = Math.min(1, Math.max(0, amount));
  return {
    blue: mixChannel(from.blue, to.blue, clampedAmount),
    green: mixChannel(from.green, to.green, clampedAmount),
    red: mixChannel(from.red, to.red, clampedAmount),
  };
}

function mixChannel(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount);
}

function formatHex(color: RgbColor): string {
  return `#${formatHexChannel(color.red)}${formatHexChannel(color.green)}${formatHexChannel(color.blue)}`;
}

function formatOpaqueRgb(color: RgbColor): string {
  return `rgb(${color.red}, ${color.green}, ${color.blue})`;
}

function formatRgba(color: RgbColor, opacity: number): string {
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${formatAlpha(opacity)})`;
}

function formatHexChannel(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function formatAlpha(value: number): string {
  const clampedValue = Math.min(1, Math.max(0, value));
  // Decimal half-steps such as 0.0875 can be represented just below their
  // mathematical value in binary, causing toFixed(3) to round down to 0.087.
  // Nudge only the tie boundary so derived CSS opacity stays deterministic.
  const roundedValue = Math.round((clampedValue + Number.EPSILON) * 1_000) / 1_000;
  return String(roundedValue);
}
