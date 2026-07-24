import type { ProviderKind } from "@t3tools/contracts";
import { assert, describe, it, vi } from "vitest";

import { matchSidebarSearchActions } from "./SidebarSearchPalette.logic";
import {
  buildSidebarSearchThreadCommands,
  type SidebarSearchCommandCallbacks,
} from "./SidebarSearchPaletteCommands";

function makeCallbacks(): SidebarSearchCommandCallbacks & {
  onSwitchModel: ReturnType<typeof vi.fn<(provider: ProviderKind, model: string) => void>>;
  onSwitchProvider: ReturnType<typeof vi.fn<(provider: ProviderKind, model: string) => void>>;
  onNewThreadInProvider: ReturnType<typeof vi.fn<(provider: ProviderKind) => void>>;
} {
  return {
    onSwitchModel: vi.fn(),
    onSwitchProvider: vi.fn(),
    onNewThreadInProvider: vi.fn(),
  };
}

describe("buildSidebarSearchThreadCommands", () => {
  it("returns nothing when there is no active thread and no project target", () => {
    const result = buildSidebarSearchThreadCommands({
      activeThread: null,
      hasNewThreadProjectTarget: false,
      hiddenProviders: [],
      providerOrder: [],
      callbacks: makeCallbacks(),
    });

    assert.deepEqual(result, []);
  });

  it("omits model/provider-switch commands when there is no active thread", () => {
    const callbacks = makeCallbacks();
    const result = buildSidebarSearchThreadCommands({
      activeThread: null,
      hasNewThreadProjectTarget: true,
      hiddenProviders: [],
      providerOrder: [],
      callbacks,
    });

    assert.isFalse(result.some((command) => command.id.startsWith("switch-model:")));
    assert.isFalse(result.some((command) => command.id.startsWith("switch-provider:")));
    assert.isTrue(result.some((command) => command.id.startsWith("new-thread-provider:")));
  });

  it("omits new-thread-in-provider commands when there is no project target", () => {
    const callbacks = makeCallbacks();
    const result = buildSidebarSearchThreadCommands({
      activeThread: { provider: "codex", model: "gpt-5.4" },
      hasNewThreadProjectTarget: false,
      hiddenProviders: [],
      providerOrder: [],
      callbacks,
    });

    assert.isFalse(result.some((command) => command.id.startsWith("new-thread-provider:")));
    assert.isTrue(result.some((command) => command.id.startsWith("switch-model:")));
    assert.isTrue(result.some((command) => command.id.startsWith("switch-provider:")));
  });

  it("builds one switch-model command per model in the active provider's catalog, excluding the current model", () => {
    const callbacks = makeCallbacks();
    const result = buildSidebarSearchThreadCommands({
      activeThread: { provider: "codex", model: "gpt-5.4" },
      hasNewThreadProjectTarget: false,
      hiddenProviders: [],
      providerOrder: [],
      callbacks,
    });

    const modelCommands = result.filter((command) => command.id.startsWith("switch-model:"));
    assert.isTrue(modelCommands.length > 0);
    assert.isFalse(modelCommands.some((command) => command.id === "switch-model:codex:gpt-5.4"));
    const gpt55Command = modelCommands.find(
      (command) => command.id === "switch-model:codex:gpt-5.5",
    );
    assert.isDefined(gpt55Command);
    assert.equal(gpt55Command?.label, "Use GPT-5.5");
    assert.equal(gpt55Command?.providerIcon, "codex");

    gpt55Command?.run?.();
    assert.deepEqual(callbacks.onSwitchModel.mock.calls, [["codex", "gpt-5.5"]]);
  });

  it("builds switch-provider commands for visible providers with a default model, excluding the active provider and hidden/undefaulted providers", () => {
    const callbacks = makeCallbacks();
    const result = buildSidebarSearchThreadCommands({
      activeThread: { provider: "codex", model: "gpt-5.4" },
      hasNewThreadProjectTarget: false,
      hiddenProviders: ["cursor"],
      providerOrder: [],
      callbacks,
    });

    const providerCommandIds = result
      .filter((command) => command.id.startsWith("switch-provider:"))
      .map((command) => command.id);

    assert.deepEqual(providerCommandIds, [
      "switch-provider:claudeAgent",
      "switch-provider:grok",
      "switch-provider:kilo",
      "switch-provider:opencode",
    ]);

    const claudeCommand = result.find((command) => command.id === "switch-provider:claudeAgent");
    claudeCommand?.run?.();
    assert.deepEqual(callbacks.onSwitchProvider.mock.calls, [["claudeAgent", "claude-sonnet-5"]]);
  });

  it("builds new-thread-in-provider commands for visible providers with a default model, respecting hiddenProviders", () => {
    const callbacks = makeCallbacks();
    const result = buildSidebarSearchThreadCommands({
      activeThread: null,
      hasNewThreadProjectTarget: true,
      hiddenProviders: ["grok"],
      providerOrder: [],
      callbacks,
    });

    const providerCommandIds = result.map((command) => command.id);
    assert.deepEqual(providerCommandIds, [
      "new-thread-provider:codex",
      "new-thread-provider:claudeAgent",
      "new-thread-provider:cursor",
      "new-thread-provider:kilo",
      "new-thread-provider:opencode",
    ]);

    const kiloCommand = result.find((command) => command.id === "new-thread-provider:kilo");
    kiloCommand?.run?.();
    assert.deepEqual(callbacks.onNewThreadInProvider.mock.calls, [["kilo"]]);
  });

  it("excludes pi from switch-provider and new-thread-in-provider commands (no static default model)", () => {
    const result = buildSidebarSearchThreadCommands({
      activeThread: { provider: "codex", model: "gpt-5.4" },
      hasNewThreadProjectTarget: true,
      hiddenProviders: [],
      providerOrder: [],
      callbacks: makeCallbacks(),
    });

    assert.isFalse(result.some((command) => command.id.includes(":pi")));
  });

  it("respects a custom providerOrder for new-thread-in-provider commands", () => {
    const result = buildSidebarSearchThreadCommands({
      activeThread: null,
      hasNewThreadProjectTarget: true,
      hiddenProviders: [],
      providerOrder: ["opencode", "kilo", "grok", "cursor", "claudeAgent", "codex", "pi"],
      callbacks: makeCallbacks(),
    });

    assert.deepEqual(
      result.map((command) => command.id),
      [
        "new-thread-provider:opencode",
        "new-thread-provider:kilo",
        "new-thread-provider:grok",
        "new-thread-provider:cursor",
        "new-thread-provider:claudeAgent",
        "new-thread-provider:codex",
      ],
    );
  });

  it("lets a search for 'opus' find a Claude Opus switch-model command", () => {
    const result = buildSidebarSearchThreadCommands({
      activeThread: { provider: "claudeAgent", model: "claude-sonnet-5" },
      hasNewThreadProjectTarget: false,
      hiddenProviders: [],
      providerOrder: [],
      callbacks: makeCallbacks(),
    });

    const matches = matchSidebarSearchActions(result, "opus");
    assert.isTrue(matches.length > 0);
    assert.isTrue(
      matches.every((match) => match.id.startsWith("switch-model:claudeAgent:claude-opus")),
    );
  });
});
