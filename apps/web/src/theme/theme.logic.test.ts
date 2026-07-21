// FILE: theme.logic.test.ts
// Purpose: Locks down theme parsing, default migration, normalization, and CSS token derivation.
// Layer: Web appearance domain tests
// Exports: Vitest coverage for theme.logic.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHROME_THEME,
  DEFAULT_THEME_STATE,
  buildResolvedThemeTokens,
  buildThemeCssVariables,
  createThemeShareString,
  getCodeThemeSeed,
  getCodeThemeSeedPatch,
  normalizeThemeState,
  parseStoredThemeState,
  parseThemeShareString,
  resolveThemePack,
  setThemeCodeThemeId,
  updateThemePackFromShareString,
} from "./theme.logic";
import { DEFAULT_MONOSPACE_FONT_FAMILY_STACK } from "../lib/fontFamily";

const PROVIDED_THEME_STRING =
  'codex-theme-v1:{"codeThemeId":"linear","theme":{"accent":"#606acc","contrast":30,"fonts":{"code":"\\"Jetbrains Mono\\"","ui":"Inter"},"ink":"#e3e4e6","opaqueWindows":true,"semanticColors":{"diffAdded":"#69c967","diffRemoved":"#ff7e78","skill":"#c2a1ff"},"surface":"#0f0f11"},"variant":"dark"}';

describe("parseStoredThemeState", () => {
  it("tolerates a legacy bare mode string without throwing", () => {
    expect(parseStoredThemeState("dark")).toEqual(DEFAULT_THEME_STATE);
    expect(parseStoredThemeState("light")).toEqual(DEFAULT_THEME_STATE);
    expect(parseStoredThemeState("system")).toEqual(DEFAULT_THEME_STATE);
  });

  it("returns the default state for null, undefined, and empty storage", () => {
    expect(parseStoredThemeState(null)).toEqual(DEFAULT_THEME_STATE);
    expect(parseStoredThemeState(undefined)).toEqual(DEFAULT_THEME_STATE);
    expect(parseStoredThemeState("")).toEqual(DEFAULT_THEME_STATE);
  });

  it("returns the default state for malformed JSON instead of throwing", () => {
    expect(parseStoredThemeState("{not json")).toEqual(DEFAULT_THEME_STATE);
  });

  it("reads the current chromeTheme/codeThemeId shape", () => {
    const parsed = parseStoredThemeState(
      JSON.stringify({
        chromeTheme: { accent: "#339cff", surface: "#000000" },
        codeThemeId: "linear",
      }),
    );

    expect(parsed.codeThemeId).toBe("linear");
    expect(parsed.chromeTheme.accent).toBe("#339cff");
    expect(parsed.chromeTheme.surface).toBe("#000000");
  });

  it("preserves the stored dark theme and code theme id from the legacy per-variant shape", () => {
    const parsed = parseStoredThemeState(
      JSON.stringify({
        mode: "dark",
        codeThemeIds: { dark: "linear", light: "github" },
        chromeThemes: {
          dark: { accent: "#339cff", surface: "#000000" },
          light: { accent: "#ff00aa", surface: "#ffffff" },
        },
      }),
    );

    expect(parsed.codeThemeId).toBe("linear");
    expect(parsed.chromeTheme.accent).toBe("#339cff");
    expect(parsed.chromeTheme.surface).toBe("#000000");
  });

  it("migrates only the legacy built-in palette while preserving fonts and the code theme", () => {
    const parsed = parseStoredThemeState(
      JSON.stringify({
        mode: "dark",
        codeThemeIds: { dark: "linear", light: "github" },
        chromeThemes: {
          dark: {
            accent: "#fb923c",
            contrast: 60,
            fonts: { code: "0xProto", ui: "Inter" },
            ink: "#f4f4f5",
            opaqueWindows: true,
            semanticColors: {
              diffAdded: "#4ade80",
              diffRemoved: "#f43f5e",
              skill: "#3b82f6",
            },
            surface: "#18181b",
          },
        },
      }),
    );

    expect(parsed.codeThemeId).toBe("linear");
    expect(parsed.chromeTheme).toMatchObject({
      ...DEFAULT_CHROME_THEME,
      fonts: { code: "0xProto", ui: "Inter" },
      // The migration keeps the user's window-material choice; only the palette moves.
      opaqueWindows: true,
    });
  });

  it("migrates retired accents even when the rest of the palette was customized", () => {
    const parsed = parseStoredThemeState(
      JSON.stringify({
        mode: "dark",
        chromeThemes: {
          dark: {
            accent: "#d97757",
            contrast: 80,
            fonts: { code: null, ui: null },
            ink: "#f4f4f5",
            opaqueWindows: false,
            semanticColors: {
              diffAdded: "#4ade80",
              diffRemoved: "#f43f5e",
              skill: "#a855f7",
            },
            surface: "#101013",
          },
        },
      }),
    );

    // The retired accent migrates to the default; the customization survives.
    expect(parsed.chromeTheme.accent).toBe(DEFAULT_CHROME_THEME.accent);
    expect(parsed.chromeTheme.contrast).toBe(80);
    expect(parsed.chromeTheme.opaqueWindows).toBe(false);
    expect(parsed.chromeTheme.surface).toBe("#101013");
  });

  it("keeps deliberately chosen non-legacy accents untouched", () => {
    const parsed = parseStoredThemeState(
      JSON.stringify({
        mode: "dark",
        chromeThemes: {
          dark: { accent: "#606acc" },
        },
      }),
    );

    expect(parsed.chromeTheme.accent).toBe("#606acc");
  });

  it("normalizes a partial stored chrome theme against the default", () => {
    expect(
      normalizeThemeState({
        codeThemeIds: { dark: "linear" },
        chromeThemes: { dark: { accent: "#606acc" } },
      }),
    ).toMatchObject({
      chromeTheme: { accent: "#606acc", contrast: 60 },
      codeThemeId: "linear",
    });
  });

  it("migrates the legacy packs shape into the chromeTheme/codeThemeId store", () => {
    const migrated = normalizeThemeState({
      mode: "dark",
      packs: {
        dark: {
          codeThemeId: "linear",
          theme: {
            accent: "#606acc",
          },
        },
      },
    });

    expect(migrated.codeThemeId).toBe("linear");
    expect(migrated.chromeTheme.accent).toBe("#606acc");
  });

  it("keeps normalization useful for legacy share payloads before storage migration", () => {
    const customDark = { ...getCodeThemeSeed("codex"), accent: "#ff00aa" };
    const normalized = normalizeThemeState({
      codeThemeIds: { dark: "codex" },
      chromeThemes: { dark: customDark },
    });

    expect(normalized.chromeTheme).toEqual(customDark);
  });
});

describe("theme share strings", () => {
  it("round-trips a normalized pack through the share-string format", () => {
    const shareString = createThemeShareString(resolveThemePack(DEFAULT_THEME_STATE));

    expect(shareString).not.toContain('"variant"');
    expect(parseThemeShareString(shareString)).toEqual({
      codeThemeId: "codex",
      theme: resolveThemePack(DEFAULT_THEME_STATE).theme,
    });
  });

  it("parses a legacy payload that explicitly marks itself dark", () => {
    expect(parseThemeShareString(PROVIDED_THEME_STRING)).toEqual({
      codeThemeId: "linear",
      theme: {
        accent: "#606acc",
        contrast: 30,
        fonts: {
          code: '"Jetbrains Mono"',
          ui: "Inter",
        },
        ink: "#e3e4e6",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#69c967",
          diffRemoved: "#ff7e78",
          skill: "#c2a1ff",
        },
        surface: "#0f0f11",
      },
    });
  });

  it("rejects a legacy payload saved from light mode", () => {
    const lightPayload =
      'codex-theme-v1:{"codeThemeId":"linear","theme":{"accent":"#5e6ad2","contrast":30,"fonts":{"code":null,"ui":"Inter"},"ink":"#1b1b1b","opaqueWindows":true,"semanticColors":{"diffAdded":"#52a450","diffRemoved":"#c94446","skill":"#8160d8"},"surface":"#fcfcfd"},"variant":"light"}';

    expect(() => parseThemeShareString(lightPayload)).toThrow(/light mode/i);
  });

  it("updates the chrome theme and code theme id when importing", () => {
    const nextState = updateThemePackFromShareString(DEFAULT_THEME_STATE, PROVIDED_THEME_STRING);

    expect(nextState.codeThemeId).toBe("linear");
    expect(nextState.chromeTheme).toEqual(parseThemeShareString(PROVIDED_THEME_STRING).theme);
  });
});

describe("code theme seeds", () => {
  it("loads the exact normalized seed for a bundled code theme", () => {
    expect(getCodeThemeSeed("linear")).toEqual({
      accent: "#606acc",
      contrast: 60,
      fonts: {
        code: null,
        ui: "Inter",
      },
      ink: "#e3e4e6",
      opaqueWindows: true,
      semanticColors: {
        diffAdded: "#69c967",
        diffRemoved: "#ff7e78",
        skill: "#c2a1ff",
      },
      surface: "#0f0f11",
    });
  });

  it("exposes only the raw seed fields that Codex merges on theme switching", () => {
    expect(getCodeThemeSeedPatch("linear")).toEqual({
      accent: "#606acc",
      fonts: {
        ui: "Inter",
      },
      ink: "#e3e4e6",
      opaqueWindows: true,
      semanticColors: {
        diffAdded: "#69c967",
        diffRemoved: "#ff7e78",
        skill: "#c2a1ff",
      },
      surface: "#0f0f11",
    });
  });

  it("merges the selected theme seed into the current pack instead of hard-resetting", () => {
    const nextState = setThemeCodeThemeId(
      {
        ...DEFAULT_THEME_STATE,
        chromeTheme: {
          ...DEFAULT_THEME_STATE.chromeTheme,
          fonts: {
            code: '"JetBrains Mono"',
            ui: "Old UI",
          },
          accent: "#ff00aa",
          contrast: 12,
          opaqueWindows: false,
        },
      },
      "linear",
    );

    expect(resolveThemePack(nextState)).toEqual({
      codeThemeId: "linear",
      theme: {
        accent: "#606acc",
        contrast: 12,
        fonts: {
          code: '"JetBrains Mono"',
          ui: "Inter",
        },
        ink: "#e3e4e6",
        opaqueWindows: true,
        semanticColors: {
          diffAdded: "#69c967",
          diffRemoved: "#ff7e78",
          skill: "#c2a1ff",
        },
        surface: "#0f0f11",
      },
    });
  });

  it("preserves current optional values when the new seed does not define them", () => {
    const nextState = setThemeCodeThemeId(
      {
        ...DEFAULT_THEME_STATE,
        chromeTheme: {
          ...DEFAULT_THEME_STATE.chromeTheme,
          fonts: {
            code: '"JetBrains Mono"',
            ui: "Current UI",
          },
          contrast: 22,
          opaqueWindows: true,
        },
      },
      "lobster",
    );

    expect(resolveThemePack(nextState)).toEqual({
      codeThemeId: "lobster",
      theme: {
        ...DEFAULT_THEME_STATE.chromeTheme,
        accent: getCodeThemeSeed("lobster").accent,
        contrast: 22,
        fonts: {
          code: '"JetBrains Mono"',
          ui: "Satoshi",
        },
        ink: getCodeThemeSeed("lobster").ink,
        opaqueWindows: true,
        semanticColors: getCodeThemeSeed("lobster").semanticColors,
        surface: getCodeThemeSeed("lobster").surface,
      },
    });
  });

  it("applies explicit contrast overrides when a seed defines them", () => {
    const nextState = setThemeCodeThemeId(
      {
        ...DEFAULT_THEME_STATE,
        chromeTheme: {
          ...DEFAULT_THEME_STATE.chromeTheme,
          contrast: 12,
        },
      },
      "vercel",
    );

    expect(resolveThemePack(nextState)).toEqual({
      codeThemeId: "vercel",
      theme: getCodeThemeSeed("vercel"),
    });
  });
});

describe("buildThemeCssVariables", () => {
  it("derives the renderer token map from the imported theme pack", () => {
    const importedTheme = parseThemeShareString(PROVIDED_THEME_STRING);
    const cssVariables = buildThemeCssVariables(
      {
        codeThemeId: importedTheme.codeThemeId,
        theme: importedTheme.theme,
      },
      { electron: true },
    );

    expect(cssVariables.material).toBe("opaque");
    expect(cssVariables.variables["--codex-base-accent"]).toBe("#606acc");
    expect(cssVariables.variables["--background"]).toBe("#070708");
    expect(cssVariables.variables["--card"]).toBe("#0f0f11");
    expect(cssVariables.variables["--composer-surface"]).toBe("#0d0d0f");
    expect(cssVariables.variables["--composer-surface"]).not.toBe(cssVariables.variables["--card"]);
    expect(cssVariables.variables["--sidebar-accent"]).toBe("rgba(227, 228, 230, 0.05)");
    expect(cssVariables.variables["--sidebar-accent-active"]).toBe("rgba(227, 228, 230, 0.08)");
    expect(cssVariables.variables["--theme-font-ui-family"]).toBe("Inter");
    expect(cssVariables.variables["--theme-font-code-family"]).toBe(
      `"Jetbrains Mono", ${DEFAULT_MONOSPACE_FONT_FAMILY_STACK}`,
    );
    expect(cssVariables.variables["--vscode-terminal-ansiBlue"]).toBe("#606acc");
    expect(cssVariables.variables["--vscode-terminal-ansiGreen"]).toBe("#56a554");
    expect(cssVariables.variables["--vscode-terminal-ansiMagenta"]).toBe("#c2a1ff");
    expect(cssVariables.variables["--vscode-terminal-ansiRed"]).toBe("#ff7e78");
    expect(cssVariables.variables["--vscode-terminal-foreground"]).toBe("#e3e4e6");
    expect(cssVariables.variables["--color-token-terminal-ansi-blue"]).toBe("#606acc");
    expect(cssVariables.variables["--color-token-terminal-ansi-green"]).toBe("#56a554");
    expect(cssVariables.variables["--color-token-terminal-ansi-magenta"]).toBe("#c2a1ff");
    expect(cssVariables.variables["--color-token-terminal-ansi-red"]).toBe("#ff7e78");
  });

  it("exposes a structured derived-token surface for retrieving non-stored colors", () => {
    const importedTheme = parseThemeShareString(PROVIDED_THEME_STRING);
    const tokens = buildResolvedThemeTokens({
      codeThemeId: importedTheme.codeThemeId,
      theme: importedTheme.theme,
    });

    expect(tokens.computed.surfaceUnder).toBe("#070708");
    expect(tokens.computed.panel).toBe("#0f0f11");
    expect(tokens.derived.textForegroundSecondary).toBe("rgba(227, 228, 230, 0.66)");
    expect(tokens.derived.buttonSecondaryBackground).toBe("rgba(227, 228, 230, 0.04)");
    expect(tokens.derived.iconAccent).toBe("#606acc");
    // Dark primary button label is the surface color (dark) on the white (ink) button.
    expect(tokens.derived.textButtonPrimary).toBe("#0f0f11");
    expect(tokens.derived.buttonPrimaryBackground).toBe("#e3e4e6");
    // Codex maps the sidebar token to the PRIMARY surface (same as main-surface-primary),
    // not the darker under-surface; mirror that so the sidebar color matches Codex.
    expect(tokens.aliases["--color-token-side-bar-background"]).toBe("#0f0f11");
    expect(tokens.aliases["--color-token-list-hover-background"]).toBe(
      tokens.derived.buttonSecondaryBackgroundHover,
    );
    expect(tokens.aliases["--color-token-dropdown-background"]).toBe(
      tokens.derived.controlBackgroundOpaque,
    );
    expect(tokens.aliases["--color-token-main-surface-primary"]).toBe("#0f0f11");
    expect(tokens.aliases["--color-token-input-background"]).toBe("rgba(27, 27, 29, 0.96)");
    expect(tokens.aliases["--color-token-terminal-background"]).toBe("#0f0f11");
    expect(tokens.aliases["--color-token-terminal-foreground"]).toBe("#e3e4e6");
    expect(tokens.aliases["--color-token-terminal-ansi-black"]).toBe(
      tokens.derived.textForegroundTertiary,
    );
    expect(tokens.aliases["--color-token-terminal-ansi-bright-black"]).toBe(
      tokens.derived.textForegroundSecondary,
    );
    expect(tokens.aliases["--color-token-terminal-ansi-yellow"]).toBe("#e94b4b");
  });

  it("derives the fixed dark appearance palette", () => {
    const variables = buildThemeCssVariables({
      codeThemeId: "codex",
      theme: DEFAULT_CHROME_THEME,
    }).variables;
    const tokens = buildResolvedThemeTokens({
      codeThemeId: "codex",
      theme: DEFAULT_CHROME_THEME,
    });

    expect(tokens.derived.controlBackgroundOpaque).toBe("rgb(39, 39, 38)");
    expect(tokens.aliases["--color-token-dropdown-background"]).toBe("rgb(39, 39, 38)");
    expect(tokens.computed.surfaceUnder).toBe("#090909");
    expect(tokens.derived.textForegroundSecondary).toBe("#807f7c");
    expect(tokens.derived.textForegroundTertiary).toBe("#585856");
    expect(variables["--background"]).toBe("#090909");
    expect(variables["--panel"]).toBe("#141414");
    expect(variables["--foreground"]).toBe("#e3e2dd");
    expect(variables["--accent"]).toBe("#3b82f6");
    // The retired brand tokens are no longer emitted at all.
    expect(variables["--claude"]).toBeUndefined();
    expect(variables["--gold"]).toBeUndefined();
    expect(variables["--composer-surface"]).toBe("#141414");
    expect(variables["--app-user-message-background"]).toBe("#141414");
    expect(variables["--vscode-terminal-ansiBlue"]).toBe("#75a7e0");
    expect(variables["--vscode-terminal-ansiCyan"]).toBe("#66b8b0");
    expect(variables["--vscode-terminal-ansiMagenta"]).toBe("#b99ad6");
  });

  it("projects the requested semantic colors and default dark canvas", () => {
    const darkVariables = buildThemeCssVariables(resolveThemePack(DEFAULT_THEME_STATE)).variables;
    const darkTokens = buildResolvedThemeTokens(resolveThemePack(DEFAULT_THEME_STATE));

    expect(darkVariables["--destructive"]).toBe("#e94b4b");
    expect(darkVariables["--success"]).toBe("#4cb782");
    expect(darkVariables["--warning"]).toBe("#e94b4b");
    expect(darkVariables["--info"]).toBe("#3b82f6");
    expect(darkTokens.computed.surfaceUnder).toBe("#090909");
  });

  it("uses the dark theme foreground color for the primary button background", () => {
    const tokens = buildResolvedThemeTokens({
      codeThemeId: "codex",
      theme: DEFAULT_THEME_STATE.chromeTheme,
    });

    // Dark mode's high-contrast primary: bg = ink (white), label = surface
    // (dark), so the primary action reads as a filled button.
    expect(tokens.derived.buttonPrimaryBackground).toBe(DEFAULT_THEME_STATE.chromeTheme.ink);
    expect(tokens.derived.textButtonPrimary).toBe(DEFAULT_THEME_STATE.chromeTheme.surface);
    expect(tokens.derived.textButtonPrimary).not.toBe(tokens.derived.buttonPrimaryBackground);
  });

  it("shares the user message bubble background with the chat code-block surface", () => {
    const pack = {
      codeThemeId: "custom-dark",
      theme: {
        ...DEFAULT_THEME_STATE.chromeTheme,
        ink: "#f2f2f0",
        surface: "#101013",
      },
    };
    const cssVariables = buildThemeCssVariables(pack);

    expect(cssVariables.variables["--app-chat-code-surface"]).toBe(
      cssVariables.variables["--app-user-message-background"],
    );
  });
});
