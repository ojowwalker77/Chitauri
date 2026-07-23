// FILE: appSettings.test.ts
// Purpose: Verifies app settings normalization, model options, and provider dispatch options.
// Layer: Web settings tests
// Exports: Vitest suites for appSettings.ts

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  DEFAULT_APP_SNAP_CHORD,
  DEFAULT_CHAT_FONT_SIZE_PX,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_TASK_LIST_DISPLAY_MODE,
  DEFAULT_TERMINAL_FONT_SIZE_PX,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  DEFAULT_TIMESTAMP_FORMAT,
  getAppModelOptions,
  getCustomBinaryPathForProvider,
  getDefaultNativeFontSmoothing,
  getCustomModelOptionsByProvider,
  getCustomModelsByProvider,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  getGitTextGenerationModelOptions,
  getProviderStartOptions,
  MODEL_PROVIDER_SETTINGS,
  normalizeChatFontSizePx,
  normalizeCustomModelSlugs,
  normalizeStoredAppSettings,
  normalizeTerminalFontSizePx,
  patchCustomModels,
  resolveAppModelSelection,
} from "./appSettings";

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });

  it("normalizes provider-specific aliases for claude", () => {
    expect(normalizeCustomModelSlugs(["sonnet"], "claudeAgent")).toEqual([]);
    expect(normalizeCustomModelSlugs(["claude/custom-sonnet"], "claudeAgent")).toEqual([
      "claude/custom-sonnet",
    ]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      provider: "codex",
      isCustom: true,
    });
  });

  it("formats unknown GPT custom models with a readable label", () => {
    const options = getAppModelOptions("codex", ["gpt-5.1-codex-max"]);

    expect(options.at(-1)).toEqual({
      slug: "gpt-5.1-codex-max",
      name: "GPT-5.1 Codex Max",
      provider: "codex",
      isCustom: true,
    });
  });

  it("keeps a saved custom provider model available as an exact slug option", () => {
    const options = getAppModelOptions("claudeAgent", ["claude/custom-opus"], "claude/custom-opus");

    expect(options.some((option) => option.slug === "claude/custom-opus" && option.isCustom)).toBe(
      true,
    );
  });
});

describe("getGitTextGenerationModelOptions", () => {
  it("merges codex and OpenCode model options for git writing settings", () => {
    const options = getGitTextGenerationModelOptions({
      customCodexModels: ["custom/codex-model"],
      customKiloModels: [],
      customOpenCodeModels: ["openrouter/gpt-oss-120b"],
      textGenerationModel: "openai/gpt-5",
      textGenerationProvider: "opencode",
    });

    expect(options.some((option) => option.slug === "gpt-5.4-mini")).toBe(true);
    expect(options.some((option) => option.slug === "openai/gpt-5")).toBe(true);
    expect(options.some((option) => option.slug === "openrouter/gpt-oss-120b")).toBe(true);
  });

  it("prefers runtime-discovered OpenCode and Kilo models for git writing settings", () => {
    const options = getGitTextGenerationModelOptions(
      {
        customCodexModels: [],
        customKiloModels: [],
        customOpenCodeModels: [],
        textGenerationModel: "openrouter/custom-model",
        textGenerationProvider: "opencode",
      },
      {
        opencode: [{ slug: "openrouter/gpt-oss-120b", name: "GPT OSS 120B" }],
        kilo: [{ slug: "kilo/kilo-auto/free", name: "Kilo Auto Free" }],
      },
    );

    expect(options.some((option) => option.slug === "openrouter/gpt-oss-120b")).toBe(true);
    expect(options.some((option) => option.slug === "kilo/kilo-auto/free")).toBe(true);
    expect(options.some((option) => option.slug === "openrouter/custom-model")).toBe(true);
  });

  it("preserves a currently selected transient git writing model", () => {
    const options = getGitTextGenerationModelOptions({
      customCodexModels: [],
      customKiloModels: [],
      customOpenCodeModels: [],
      textGenerationModel: "openrouter/custom-model",
      textGenerationProvider: "opencode",
    });

    expect(options.at(-1)).toEqual({
      slug: "openrouter/custom-model",
      name: "Custom Model",
      provider: "opencode",
      isCustom: true,
    });
  });

  it("humanizes transient OpenCode git-writing models instead of showing the raw slug", () => {
    const options = getGitTextGenerationModelOptions({
      customCodexModels: [],
      customKiloModels: [],
      customOpenCodeModels: [],
      textGenerationModel: "opencode-go/kimi-k2.6",
      textGenerationProvider: "opencode",
    });

    expect(options.at(-1)).toEqual({
      slug: "opencode-go/kimi-k2.6",
      name: "Kimi K2.6",
      provider: "opencode",
      isCustom: true,
    });
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        {
          codex: ["galapagos-alpha"],
          claudeAgent: [],
          cursor: [],

          grok: [],
          kilo: [],
          opencode: [],
          pi: [],
        },
        "galapagos-alpha",
      ),
    ).toBe("galapagos-alpha");
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        {
          codex: [],
          claudeAgent: [],
          cursor: [],

          grok: [],
          kilo: [],
          opencode: [],
          pi: [],
        },
        "",
      ),
    ).toBe("gpt-5.5");
  });

  it("resolves display names through the shared resolver", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        {
          codex: [],
          claudeAgent: [],
          cursor: [],

          grok: [],
          kilo: [],
          opencode: [],
          pi: [],
        },
        "GPT-5.3 Codex",
      ),
    ).toBe("gpt-5.3-codex");
  });

  it("resolves aliases through the shared resolver", () => {
    expect(
      resolveAppModelSelection(
        "claudeAgent",
        {
          codex: [],
          claudeAgent: [],
          cursor: [],

          grok: [],
          kilo: [],
          opencode: [],
          pi: [],
        },
        "sonnet",
      ),
    ).toBe("claude-sonnet-5");
  });

  it("resolves transient selected custom models included in app model options", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        {
          codex: [],
          claudeAgent: [],
          cursor: [],

          grok: [],
          kilo: [],
          opencode: [],
          pi: [],
        },
        "custom/selected-model",
      ),
    ).toBe("custom/selected-model");
  });
});

describe("timestamp format defaults", () => {
  it("defaults timestamp format to locale", () => {
    expect(DEFAULT_TIMESTAMP_FORMAT).toBe("locale");
  });
});

describe("chat font size defaults", () => {
  it("defaults chat font size to 12px", () => {
    expect(DEFAULT_CHAT_FONT_SIZE_PX).toBe(14);
  });

  it("clamps chat font size updates into the supported range", () => {
    expect(normalizeChatFontSizePx(9)).toBe(11);
    expect(normalizeChatFontSizePx(18.4)).toBe(18);
    expect(normalizeChatFontSizePx(Number.NaN)).toBe(DEFAULT_CHAT_FONT_SIZE_PX);
  });
});

describe("terminal font size defaults", () => {
  it("defaults terminal font size to 12px", () => {
    expect(DEFAULT_TERMINAL_FONT_SIZE_PX).toBe(12);
  });

  it("clamps terminal font size updates into the supported range", () => {
    expect(normalizeTerminalFontSizePx(8)).toBe(11);
    expect(normalizeTerminalFontSizePx(20.4)).toBe(20);
    expect(normalizeTerminalFontSizePx(99)).toBe(22);
    expect(normalizeTerminalFontSizePx(Number.NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE_PX);
  });
});

describe("sidebar sort defaults", () => {
  it("defaults project sorting to manual", () => {
    expect(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER).toBe("manual");
  });

  it("defaults thread sorting to updated_at", () => {
    expect(DEFAULT_SIDEBAR_THREAD_SORT_ORDER).toBe("updated_at");
  });
});

describe("normalizeStoredAppSettings", () => {
  it("defaults native font smoothing by platform", () => {
    expect(getDefaultNativeFontSmoothing("MacIntel")).toBe(true);
    expect(getDefaultNativeFontSmoothing("Win32")).toBe(false);
    expect(getDefaultNativeFontSmoothing("Linux x86_64")).toBe(false);
  });

  it("uses the current platform default for existing settings without a stored value", () => {
    const decodedSettings = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema))("{}");

    expect(decodedSettings.enableNativeFontSmoothing).toBe(getDefaultNativeFontSmoothing());
  });

  it("drops legacy font-family preferences now that fonts are bundled and fixed", () => {
    const decodedSettings = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema))(
      JSON.stringify({
        chatCodeFontFamily: "JetBrains Mono",
        terminalFontFamily: "Fira Code",
      }),
    );

    expect(decodedSettings).not.toHaveProperty("chatCodeFontFamily");
    expect(decodedSettings).not.toHaveProperty("terminalFontFamily");
  });

  it("preserves an explicitly stored updated_at project sort order", () => {
    const decodedSettings = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema))(
      JSON.stringify({
        sidebarProjectSortOrder: "updated_at",
        chatFontSizePx: 99,
        terminalFontSizePx: 3,
        customCodexModels: [" custom/internal-model ", "gpt-5.4", "custom/internal-model"],
      }),
    );

    expect(normalizeStoredAppSettings(decodedSettings)).toMatchObject({
      sidebarProjectSortOrder: "updated_at",
      chatFontSizePx: 18,
      terminalFontSizePx: 11,
      customCodexModels: ["custom/internal-model"],
    });
  });

  it("drops default provider command names so they do not look like custom paths", () => {
    const decodedSettings = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema))(
      JSON.stringify({
        claudeBinaryPath: "claude",
        codexBinaryPath: "codex",
        cursorBinaryPath: "cursor-agent",
        grokBinaryPath: "grok",
        kiloBinaryPath: "kilo",
        openCodeBinaryPath: "opencode",
        piBinaryPath: "pi",
      }),
    );
    const normalized = normalizeStoredAppSettings(decodedSettings);

    expect(normalized).toMatchObject({
      claudeBinaryPath: "",
      codexBinaryPath: "",
      cursorBinaryPath: "",
      grokBinaryPath: "",
      kiloBinaryPath: "",
      openCodeBinaryPath: "",
      piBinaryPath: "",
    });
    expect(getCustomBinaryPathForProvider(normalized, "opencode")).toBe("");
  });
});

describe("provider-specific custom models", () => {
  it("includes provider-specific custom slugs in non-codex model lists", () => {
    const claudeOptions = getAppModelOptions("claudeAgent", ["claude/custom-opus"]);

    expect(claudeOptions.some((option) => option.slug === "claude/custom-opus")).toBe(true);
  });
});

describe("getProviderStartOptions", () => {
  it("returns only populated provider overrides", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "/usr/local/bin/claude",
        codexBinaryPath: "",
        codexHomePath: "/Users/you/.codex",
        cursorApiEndpoint: "http://localhost:3000",
        cursorBinaryPath: "/usr/local/bin/agent",
        grokBinaryPath: "/usr/local/bin/grok",
        kiloBinaryPath: "",
        kiloServerPassword: "",
        kiloServerUrl: "",
        openCodeBinaryPath: "",
        openCodeExperimentalWebSockets: false,
        openCodeServerPassword: "",
        openCodeServerUrl: "",
        piAgentDir: "",
        piBinaryPath: "",
      }),
    ).toEqual({
      claudeAgent: {
        binaryPath: "/usr/local/bin/claude",
      },
      codex: {
        homePath: "/Users/you/.codex",
      },
      cursor: {
        apiEndpoint: "http://localhost:3000",
        binaryPath: "/usr/local/bin/agent",
      },
      grok: {
        binaryPath: "/usr/local/bin/grok",
      },
    });
  });

  it("returns undefined when no provider overrides are configured", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "",
        codexBinaryPath: "",
        codexHomePath: "",
        cursorApiEndpoint: "",
        cursorBinaryPath: "",
        grokBinaryPath: "",
        kiloBinaryPath: "",
        kiloServerPassword: "",
        kiloServerUrl: "",
        openCodeBinaryPath: "",
        openCodeExperimentalWebSockets: false,
        openCodeServerPassword: "",
        openCodeServerUrl: "",
        piAgentDir: "",
        piBinaryPath: "",
      }),
    ).toBeUndefined();
  });

  it("ignores default provider command names as custom binary overrides", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "claude",
        codexBinaryPath: "codex",
        codexHomePath: "",
        cursorApiEndpoint: "",
        cursorBinaryPath: "cursor-agent",
        grokBinaryPath: "grok",
        kiloBinaryPath: "kilo",
        kiloServerPassword: "",
        kiloServerUrl: "",
        openCodeBinaryPath: "opencode",
        openCodeExperimentalWebSockets: false,
        openCodeServerPassword: "",
        openCodeServerUrl: "",
        piAgentDir: "",
        piBinaryPath: "pi",
      }),
    ).toBeUndefined();
  });
});

describe("provider-indexed custom model settings", () => {
  const settings = {
    customCodexModels: ["custom/codex-model"],
    customClaudeModels: ["claude/custom-opus"],
    customCursorModels: ["cursor/custom-model"],
    customGrokModels: ["grok/custom-fast"],
    customKiloModels: ["kilo/kilo-auto/free"],
    customOpenCodeModels: ["openrouter/gpt-oss-120b"],
    customPiModels: ["anthropic/custom-pi"],
  } as const;

  it("exports one provider config per provider", () => {
    expect(MODEL_PROVIDER_SETTINGS.map((config) => config.provider)).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "kilo",
      "opencode",
      "pi",
    ]);
  });

  it("reads custom models for each provider", () => {
    expect(getCustomModelsForProvider(settings, "codex")).toEqual(["custom/codex-model"]);
    expect(getCustomModelsForProvider(settings, "claudeAgent")).toEqual(["claude/custom-opus"]);
    expect(getCustomModelsForProvider(settings, "cursor")).toEqual(["cursor/custom-model"]);
    expect(getCustomModelsForProvider(settings, "grok")).toEqual(["grok/custom-fast"]);
    expect(getCustomModelsForProvider(settings, "kilo")).toEqual(["kilo/kilo-auto/free"]);
    expect(getCustomModelsForProvider(settings, "opencode")).toEqual(["openrouter/gpt-oss-120b"]);
    expect(getCustomModelsForProvider(settings, "pi")).toEqual(["anthropic/custom-pi"]);
  });

  it("reads default custom models for each provider", () => {
    const defaults = {
      customCodexModels: ["default/codex-model"],
      customClaudeModels: ["claude/default-opus"],
      customCursorModels: ["cursor/default-model"],
      customGrokModels: ["grok/default-fast"],
      customKiloModels: ["kilo/default-auto"],
      customOpenCodeModels: ["openai/gpt-5"],
      customPiModels: ["anthropic/default-pi"],
    } as const;

    expect(getDefaultCustomModelsForProvider(defaults, "codex")).toEqual(["default/codex-model"]);
    expect(getDefaultCustomModelsForProvider(defaults, "claudeAgent")).toEqual([
      "claude/default-opus",
    ]);
    expect(getDefaultCustomModelsForProvider(defaults, "cursor")).toEqual(["cursor/default-model"]);
    expect(getDefaultCustomModelsForProvider(defaults, "grok")).toEqual(["grok/default-fast"]);
    expect(getDefaultCustomModelsForProvider(defaults, "kilo")).toEqual(["kilo/default-auto"]);
    expect(getDefaultCustomModelsForProvider(defaults, "opencode")).toEqual(["openai/gpt-5"]);
    expect(getDefaultCustomModelsForProvider(defaults, "pi")).toEqual(["anthropic/default-pi"]);
  });

  it("patches custom models for codex", () => {
    expect(patchCustomModels("codex", ["custom/codex-model"])).toEqual({
      customCodexModels: ["custom/codex-model"],
    });
  });

  it("patches custom models for claude", () => {
    expect(patchCustomModels("claudeAgent", ["claude/custom-opus"])).toEqual({
      customClaudeModels: ["claude/custom-opus"],
    });
  });

  it("patches custom models for grok", () => {
    expect(patchCustomModels("grok", ["grok/custom-fast"])).toEqual({
      customGrokModels: ["grok/custom-fast"],
    });
  });

  it("patches custom models for cursor", () => {
    expect(patchCustomModels("cursor", ["cursor/custom-model"])).toEqual({
      customCursorModels: ["cursor/custom-model"],
    });
  });

  it("patches custom models for opencode", () => {
    expect(patchCustomModels("opencode", ["openrouter/gpt-oss-120b"])).toEqual({
      customOpenCodeModels: ["openrouter/gpt-oss-120b"],
    });
  });

  it("patches custom models for kilo", () => {
    expect(patchCustomModels("kilo", ["kilo/kilo-auto/free"])).toEqual({
      customKiloModels: ["kilo/kilo-auto/free"],
    });
  });

  it("patches custom models for pi", () => {
    expect(patchCustomModels("pi", ["anthropic/custom-pi"])).toEqual({
      customPiModels: ["anthropic/custom-pi"],
    });
  });

  it("builds a complete provider-indexed custom model record", () => {
    expect(getCustomModelsByProvider(settings)).toEqual({
      codex: ["custom/codex-model"],
      claudeAgent: ["claude/custom-opus"],
      cursor: ["cursor/custom-model"],
      grok: ["grok/custom-fast"],
      kilo: ["kilo/kilo-auto/free"],
      opencode: ["openrouter/gpt-oss-120b"],
      pi: ["anthropic/custom-pi"],
    });
  });

  it("builds provider-indexed model options including custom models", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider(settings);

    expect(
      modelOptionsByProvider.codex.some((option) => option.slug === "custom/codex-model"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.claudeAgent.some((option) => option.slug === "claude/custom-opus"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.cursor.some((option) => option.slug === "cursor/custom-model"),
    ).toBe(true);
    expect(modelOptionsByProvider.grok.some((option) => option.slug === "grok/custom-fast")).toBe(
      true,
    );
    expect(
      modelOptionsByProvider.kilo.some((option) => option.slug === "kilo/kilo-auto/free"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.opencode.some((option) => option.slug === "openrouter/gpt-oss-120b"),
    ).toBe(true);
    expect(modelOptionsByProvider.pi.some((option) => option.slug === "anthropic/custom-pi")).toBe(
      true,
    );
  });

  it("normalizes and deduplicates custom model options per provider", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider({
      customCodexModels: ["  custom/codex-model ", "gpt-5.4", "custom/codex-model"],
      customClaudeModels: [" sonnet ", "claude/custom-opus", "claude/custom-opus"],
      customCursorModels: [" composer-2 ", "cursor/custom-model", "cursor/custom-model"],
      customGrokModels: [" grok-build ", "grok/custom-fast", "grok/custom-fast"],
      customKiloModels: [" kilo/kilo-auto/free ", "kilo/kilo-auto/free"],
      customOpenCodeModels: [
        " openai/gpt-5 ",
        "openrouter/gpt-oss-120b",
        "openrouter/gpt-oss-120b",
      ],
      customPiModels: [
        " anthropic/claude-sonnet-4-5 ",
        "anthropic/custom-pi",
        "anthropic/custom-pi",
      ],
    });

    expect(
      modelOptionsByProvider.codex.filter((option) => option.slug === "custom/codex-model"),
    ).toHaveLength(1);
    expect(modelOptionsByProvider.codex.some((option) => option.slug === "gpt-5.4")).toBe(true);
    expect(
      modelOptionsByProvider.claudeAgent.filter((option) => option.slug === "claude/custom-opus"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.claudeAgent.some((option) => option.slug === "claude-sonnet-5"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.cursor.filter((option) => option.slug === "cursor/custom-model"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.grok.filter((option) => option.slug === "grok/custom-fast"),
    ).toHaveLength(1);
    expect(modelOptionsByProvider.grok.some((option) => option.slug === "grok-build-0.1")).toBe(
      true,
    );
    expect(modelOptionsByProvider.grok.some((option) => option.slug === "grok-build")).toBe(true);
    expect(
      modelOptionsByProvider.kilo.filter((option) => option.slug === "kilo/kilo-auto/free"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.opencode.filter((option) => option.slug === "openrouter/gpt-oss-120b"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.pi.filter((option) => option.slug === "anthropic/custom-pi"),
    ).toHaveLength(1);
  });
});

describe("AppSettingsSchema", () => {
  it("fills decoding defaults for persisted settings that predate newer keys", () => {
    const decode = Schema.decodeSync(Schema.fromJsonString(AppSettingsSchema));

    expect(
      decode(
        JSON.stringify({
          codexBinaryPath: "/usr/local/bin/codex",
          confirmThreadDelete: false,
        }),
      ),
    ).toMatchObject({
      claudeBinaryPath: "",
      chatFontSizePx: DEFAULT_CHAT_FONT_SIZE_PX,
      codexBinaryPath: "/usr/local/bin/codex",
      codexHomePath: "",
      grokBinaryPath: "",
      defaultRuntimeMode: "full-access",
      taskListDisplayMode: DEFAULT_TASK_LIST_DISPLAY_MODE,
      confirmThreadDelete: false,
      confirmTerminalTabClose: true,
      enableAssistantStreaming: true,
      enableAppSnap: false,
      appSnapChord: DEFAULT_APP_SNAP_CHORD,
      appSnapPlaySound: true,
      sidebarProjectSortOrder: DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
      sidebarThreadSortOrder: DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
      timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
      customCodexModels: [],
      customClaudeModels: [],
      customCursorModels: [],
      customGrokModels: [],
      customKiloModels: [],
      customOpenCodeModels: [],
      customPiModels: [],
    });
  });
});
