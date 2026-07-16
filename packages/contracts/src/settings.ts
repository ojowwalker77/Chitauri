import { Schema } from "effect";
import { TrimmedString } from "./baseSchemas";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL } from "./model";
import {
  ClaudeModelSelection,
  CodexModelSelection,
  ModelSelection,
  ProviderKind,
  ThreadEnvironmentMode,
} from "./orchestration";

export const OrchestratorLane = Schema.Literals(["bulk", "ui", "explore", "verify"]);
export type OrchestratorLane = typeof OrchestratorLane.Type;

export const OrchestratorLaneRoute = Schema.Struct({
  modelSelection: ModelSelection,
  escalation: Schema.Array(ModelSelection).pipe(Schema.withDecodingDefault(() => [])),
});
export type OrchestratorLaneRoute = typeof OrchestratorLaneRoute.Type;

export const OrchestratorSeatModelSelection = Schema.Union([
  CodexModelSelection,
  ClaudeModelSelection,
]);
export type OrchestratorSeatModelSelection = typeof OrchestratorSeatModelSelection.Type;

export const OrchestratorRoutingPolicy = Schema.Struct({
  // The control-plane MCP is injected through the official Codex and Claude
  // harnesses. ACP-backed providers do not currently expose this capability.
  seatModels: Schema.Array(OrchestratorSeatModelSelection).check(Schema.isMinLength(1)),
  lanes: Schema.Struct({
    bulk: OrchestratorLaneRoute,
    ui: OrchestratorLaneRoute,
    explore: OrchestratorLaneRoute,
    verify: OrchestratorLaneRoute,
  }),
  autoVerifyDiffs: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type OrchestratorRoutingPolicy = typeof OrchestratorRoutingPolicy.Type;

export const DEFAULT_ORCHESTRATOR_ROUTING_POLICY: OrchestratorRoutingPolicy = {
  seatModels: [
    { provider: "codex", model: "gpt-5.6-sol" },
    { provider: "claudeAgent", model: "claude-fable-5" },
  ],
  lanes: {
    bulk: {
      modelSelection: {
        provider: "codex",
        model: "gpt-5.6-terra",
        options: { reasoningEffort: "high" },
      },
      escalation: [{ provider: "codex", model: "gpt-5.6-sol" }],
    },
    ui: {
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-8",
        options: { effort: "high" },
      },
      escalation: [{ provider: "claudeAgent", model: "claude-fable-5" }],
    },
    explore: {
      modelSelection: {
        provider: "codex",
        model: "gpt-5.6-luna",
        options: { reasoningEffort: "medium" },
      },
      escalation: [],
    },
    verify: {
      modelSelection: {
        provider: "codex",
        model: "gpt-5.6-sol",
        options: { reasoningEffort: "high" },
      },
      escalation: [{ provider: "claudeAgent", model: "claude-fable-5" }],
    },
  },
  autoVerifyDiffs: false,
};

const StringSetting = TrimmedString.check(Schema.isMaxLength(4096));
const CustomModels = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).pipe(
  Schema.withDecodingDefault(() => []),
);

const ProviderSettingsBase = {
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  customModels: CustomModels,
};

export const CodexServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "codex")),
  homePath: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type CodexServerProviderSettings = typeof CodexServerProviderSettings.Type;

export const ClaudeServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "claude")),
  launchArgs: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
});
export type ClaudeServerProviderSettings = typeof ClaudeServerProviderSettings.Type;

export const GrokServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "grok")),
});
export type GrokServerProviderSettings = typeof GrokServerProviderSettings.Type;

export const CursorServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "cursor-agent")),
  apiEndpoint: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type CursorServerProviderSettings = typeof CursorServerProviderSettings.Type;

export const OpenCodeServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "opencode")),
  serverUrl: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  serverPassword: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  experimentalWebSockets: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type OpenCodeServerProviderSettings = typeof OpenCodeServerProviderSettings.Type;

export const KiloServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "kilo")),
  serverUrl: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  serverPassword: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type KiloServerProviderSettings = typeof KiloServerProviderSettings.Type;

export const PiServerProviderSettings = Schema.Struct({
  ...ProviderSettingsBase,
  binaryPath: StringSetting.pipe(Schema.withDecodingDefault(() => "pi")),
  agentDir: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
});
export type PiServerProviderSettings = typeof PiServerProviderSettings.Type;

const DisabledSkillNames = Schema.Array(Schema.String.check(Schema.isMaxLength(256))).pipe(
  Schema.withDecodingDefault(() => []),
);

// User-level skill toggles. Skills are keyed by lowercased name because the
// unified catalog dedupes provider copies of the same skill by name.
export const SkillsServerSettings = Schema.Struct({
  disabled: DisabledSkillNames,
});
export type SkillsServerSettings = typeof SkillsServerSettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  enableProviderUpdateChecks: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  defaultThreadEnvMode: ThreadEnvironmentMode.pipe(Schema.withDecodingDefault(() => "local")),
  addProjectBaseDirectory: StringSetting.pipe(Schema.withDecodingDefault(() => "")),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "codex" as const,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL,
    })),
  ),
  providers: Schema.Struct({
    codex: CodexServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    cursor: CursorServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    grok: GrokServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    kilo: KiloServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    opencode: OpenCodeServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    pi: PiServerProviderSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
  skills: SkillsServerSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  orchestrator: OrchestratorRoutingPolicy.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATOR_ROUTING_POLICY),
  ),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

const ModelSelectionPatch = Schema.Struct({
  provider: Schema.optionalKey(ProviderKind),
  model: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
  options: Schema.optionalKey(Schema.Unknown),
});

const ProviderSettingsBasePatch = {
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(StringSetting),
  customModels: Schema.optionalKey(CustomModels),
};

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  enableProviderUpdateChecks: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvironmentMode),
  addProjectBaseDirectory: Schema.optionalKey(StringSetting),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          homePath: Schema.optionalKey(StringSetting),
        }),
      ),
      claudeAgent: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          launchArgs: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4096))),
        }),
      ),
      cursor: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          apiEndpoint: Schema.optionalKey(StringSetting),
        }),
      ),
      grok: Schema.optionalKey(Schema.Struct(ProviderSettingsBasePatch)),
      kilo: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          serverUrl: Schema.optionalKey(StringSetting),
          serverPassword: Schema.optionalKey(StringSetting),
        }),
      ),
      opencode: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          serverUrl: Schema.optionalKey(StringSetting),
          serverPassword: Schema.optionalKey(StringSetting),
          experimentalWebSockets: Schema.optionalKey(Schema.Boolean),
        }),
      ),
      pi: Schema.optionalKey(
        Schema.Struct({
          ...ProviderSettingsBasePatch,
          binaryPath: Schema.optionalKey(StringSetting),
          agentDir: Schema.optionalKey(StringSetting),
        }),
      ),
    }),
  ),
  skills: Schema.optionalKey(
    Schema.Struct({
      disabled: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(256)))),
    }),
  ),
  orchestrator: Schema.optionalKey(OrchestratorRoutingPolicy),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}
