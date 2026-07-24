// FILE: SidebarSearchPaletteCommands.ts
// Purpose: Builds ⌘K palette commands that act on the ACTIVE thread — switch its model,
// switch its provider, or start a fresh thread on another provider — so the palette can
// execute changes without leaving the keyboard.
// Layer: Sidebar command palette
// Exports: buildSidebarSearchThreadCommands
//
// Kept separate from SidebarSearchPalette.logic.ts (which only scores an already-built
// command list) so construction of these thread-scoped commands stays independently
// unit-testable. This module has no store/React dependency: callers inject dispatch via
// `callbacks`, mirroring how the palette's fixed actions dispatch through props
// (onCreateChat/onOpenSettings/etc.) rather than reaching into stores themselves.

import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from "@t3tools/contracts";
import { getDefaultModel, getModelOptions } from "@t3tools/shared/model";
import { compareProvidersByOrder, DEFAULT_PROVIDER_ORDER } from "../providerOrdering";
import type { SidebarSearchAction } from "./SidebarSearchPalette.logic";

/**
 * `pi`'s model catalog is fully runtime-discovered: `MODEL_OPTIONS_BY_PROVIDER.pi` is `[]`
 * and `pi` has no entry in `DEFAULT_MODEL_BY_PROVIDER` (packages/contracts/src/model.ts).
 * Building a "Switch to Pi" / "New Pi thread" command would need a live model-discovery
 * query threaded down into the sidebar to pick a real slug — the same gap
 * `useHandleNewThread`'s `applyProviderOverride` already no-ops around. Rather than create
 * a command that would silently keep whatever model the thread already has instead of
 * actually switching to Pi, this builder omits the provider entirely until it ships a
 * static default model. Threads already running on Pi are unaffected everywhere else.
 */
function hasResolvableDefaultModel(provider: ProviderKind): boolean {
  return getDefaultModel(provider) !== null;
}

export interface SidebarSearchActiveThreadCommandContext {
  /** Active thread's current provider. */
  provider: ProviderKind;
  /** Active thread's current model slug. */
  model: string;
}

export interface SidebarSearchCommandCallbacks {
  /** Switch the active thread to a specific model, keeping its current provider. */
  onSwitchModel: (provider: ProviderKind, model: string) => void;
  /** Switch the active thread to a different provider's default model. */
  onSwitchProvider: (provider: ProviderKind, model: string) => void;
  /** Start a fresh thread in the current project on the given provider. */
  onNewThreadInProvider: (provider: ProviderKind) => void;
}

export interface BuildSidebarSearchThreadCommandsInput {
  /** Null when there is no active thread — model/provider commands are omitted entirely. */
  activeThread: SidebarSearchActiveThreadCommandContext | null;
  /** True when there is a project a new thread could be created in. */
  hasNewThreadProjectTarget: boolean;
  /** Providers the user explicitly hid (appSettings.hiddenProviders). */
  hiddenProviders: ReadonlyArray<ProviderKind>;
  /** appSettings.providerOrder — same ordering the composer's ProviderModelPicker uses. */
  providerOrder: ReadonlyArray<ProviderKind>;
  callbacks: SidebarSearchCommandCallbacks;
}

function sortedVisibleProviders(
  hiddenProviders: ReadonlyArray<ProviderKind>,
  providerOrder: ReadonlyArray<ProviderKind>,
): ProviderKind[] {
  const hiddenSet = new Set(hiddenProviders);
  return DEFAULT_PROVIDER_ORDER.filter((provider) => !hiddenSet.has(provider)).toSorted(
    (left, right) => compareProvidersByOrder(providerOrder, left, right),
  );
}

// One command per model in the active provider's static catalog, excluding the model
// the thread is already on (selecting your current model would be a no-op).
function buildSwitchModelCommands(
  activeThread: SidebarSearchActiveThreadCommandContext,
  onSwitchModel: SidebarSearchCommandCallbacks["onSwitchModel"],
): SidebarSearchAction[] {
  return getModelOptions(activeThread.provider)
    .filter((option) => option.slug !== activeThread.model)
    .map((option) => ({
      id: `switch-model:${activeThread.provider}:${option.slug}`,
      label: `Use ${option.name}`,
      description: `Switch the active thread to ${option.name}.`,
      keywords: [option.name.toLowerCase(), option.slug.toLowerCase(), "model", "switch model"],
      providerIcon: activeThread.provider,
      run: () => onSwitchModel(activeThread.provider, option.slug),
    }));
}

// One command per visible, non-active provider that has a resolvable default model.
// Switching to the provider the thread is already on is intentionally omitted — that's
// what the "switch model" commands are for.
function buildSwitchProviderCommands(
  activeThread: SidebarSearchActiveThreadCommandContext,
  visibleProviders: ReadonlyArray<ProviderKind>,
  onSwitchProvider: SidebarSearchCommandCallbacks["onSwitchProvider"],
): SidebarSearchAction[] {
  const commands: SidebarSearchAction[] = [];
  for (const provider of visibleProviders) {
    if (provider === activeThread.provider) continue;
    const defaultModel = getDefaultModel(provider);
    if (!defaultModel) continue;
    const name = PROVIDER_DISPLAY_NAMES[provider];
    commands.push({
      id: `switch-provider:${provider}`,
      label: `Switch to ${name}`,
      description: `Switch the active thread's provider to ${name}.`,
      keywords: [name.toLowerCase(), "provider", "switch provider"],
      providerIcon: provider,
      run: () => onSwitchProvider(provider, defaultModel),
    });
  }
  return commands;
}

// One command per visible provider (including the active thread's provider, if any —
// this always creates a *new* thread, so it's never a no-op) that has a resolvable
// default model.
function buildNewThreadInProviderCommands(
  visibleProviders: ReadonlyArray<ProviderKind>,
  onNewThreadInProvider: SidebarSearchCommandCallbacks["onNewThreadInProvider"],
): SidebarSearchAction[] {
  const commands: SidebarSearchAction[] = [];
  for (const provider of visibleProviders) {
    if (!hasResolvableDefaultModel(provider)) continue;
    const name = PROVIDER_DISPLAY_NAMES[provider];
    commands.push({
      id: `new-thread-provider:${provider}`,
      label: `New ${name} thread`,
      description: `Start a fresh ${name} thread in the current Worker.`,
      keywords: ["new", "thread", name.toLowerCase()],
      providerIcon: provider,
      run: () => onNewThreadInProvider(provider),
    });
  }
  return commands;
}

/**
 * Builds the palette commands that act on the active thread / current project: switch
 * the active thread's model, switch its provider, or start a fresh thread on another
 * provider. A family whose gating condition isn't met (no active thread, no project
 * target) simply contributes no commands — callers can always spread the result
 * directly into the palette's flat action list.
 *
 * Branch-switch commands are intentionally NOT built here yet. Resolving the right git
 * cwd for the active thread's worktree needs the same
 * `resolveThreadBranchSourceCwd`/`resolvedThreadWorktreePath` derivation ChatView already
 * does (see ChatView.tsx), which depends on thread-session state not available at the
 * sidebar level today. Wiring it here would mean duplicating (or hoisting) that
 * derivation just for the palette.
 * TODO(sidebar-search-palette-branch-switch): once that derivation is available outside
 * ChatView, add a `setDraftThreadContext(activeThreadId, { branch })` command per branch.
 *
 * Voice is intentionally out of scope: `useCodexVoiceSession` is a hook bound to
 * ChatView's component lifecycle, not something a stateless palette command can invoke.
 */
export function buildSidebarSearchThreadCommands(
  input: BuildSidebarSearchThreadCommandsInput,
): SidebarSearchAction[] {
  const visibleProviders = sortedVisibleProviders(input.hiddenProviders, input.providerOrder);

  const newThreadCommands = input.hasNewThreadProjectTarget
    ? buildNewThreadInProviderCommands(visibleProviders, input.callbacks.onNewThreadInProvider)
    : [];

  if (!input.activeThread) {
    return newThreadCommands;
  }

  return [
    ...buildSwitchModelCommands(input.activeThread, input.callbacks.onSwitchModel),
    ...buildSwitchProviderCommands(
      input.activeThread,
      visibleProviders,
      input.callbacks.onSwitchProvider,
    ),
    ...newThreadCommands,
  ];
}
