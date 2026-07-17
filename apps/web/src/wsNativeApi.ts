// FILE: wsNativeApi.ts
// Purpose: NativeApi implementation backed by the browser WebSocket RPC transport.
// Layer: Web transport adapter
// Exports: createWsNativeApi and event subscription helpers for server push channels.

import {
  type AuthBearerBootstrapResult,
  type AuthBootstrapInput,
  type AuthBootstrapResult,
  type AuthClientSession,
  type AuthCreatePairingCredentialInput,
  type AuthPairingCredentialResult,
  type AuthPairingLink,
  type AuthRevokeClientSessionInput,
  type AuthRevokePairingLinkInput,
  type AuthSessionState,
  type AuthWebSocketTokenResult,
  type GitActionProgressEvent,
  type OrchestrationEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadStreamItem,
  type ProjectDevServerEvent,
  type ServerProviderStatusesUpdatedPayload,
  type ServerLifecycleStreamEvent,
  type ServerSettingsUpdatedPayload,
  type TerminalEvent,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  type ContextMenuItem,
  type NativeApi,
  ServerConfigUpdatedPayload,
  WS_CHANNELS,
  WS_METHODS,
  type WsWelcomePayload,
} from "@t3tools/contracts";

import { showConfirmDialogFallback } from "./confirmDialogFallback";
import { showContextMenuFallback } from "./contextMenuFallback";
import { WsTransport } from "./wsTransport";
import { emitWsTransportState } from "./wsTransportEvents";

let instance: { api: NativeApi; transport: WsTransport } | null = null;
const welcomeListeners = new Set<(payload: WsWelcomePayload) => void>();
const serverConfigUpdatedListeners = new Set<(payload: ServerConfigUpdatedPayload) => void>();
const serverProviderStatusesUpdatedListeners = new Set<
  (payload: ServerProviderStatusesUpdatedPayload) => void
>();
const serverMaintenanceUpdatedListeners = new Set<(payload: ServerLifecycleStreamEvent) => void>();
const serverSettingsUpdatedListeners = new Set<(payload: ServerSettingsUpdatedPayload) => void>();
const gitActionProgressListeners = new Set<(payload: GitActionProgressEvent) => void>();

function omitNullUserInputAnswers(
  command: Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0],
) {
  if (command.type !== "thread.user-input.respond") {
    return command;
  }

  return {
    ...command,
    answers: Object.fromEntries(
      Object.entries(command.answers).filter(
        ([, answer]) => answer !== null && answer !== undefined,
      ),
    ),
  };
}
const terminalEventListeners = new Set<(payload: TerminalEvent) => void>();
const projectDevServerEventListeners = new Set<(payload: ProjectDevServerEvent) => void>();
const orchestrationDomainEventListeners = new Set<(payload: OrchestrationEvent) => void>();
const orchestrationShellEventListeners = new Set<(payload: OrchestrationShellStreamItem) => void>();
const orchestrationThreadEventListeners = new Set<
  (payload: OrchestrationThreadStreamItem) => void
>();

async function requestAuthJson<T>(
  path: string,
  options: {
    readonly method?: "GET" | "POST";
    readonly body?: unknown;
  } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    ...(hasBody
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Auth request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
export function onServerWelcome(listener: (payload: WsWelcomePayload) => void): () => void {
  welcomeListeners.add(listener);

  const latestWelcome = instance?.transport.getLatestPush(WS_CHANNELS.serverWelcome)?.data ?? null;
  if (latestWelcome) {
    try {
      listener(latestWelcome);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    welcomeListeners.delete(listener);
  };
}

/**
 * Subscribe to server config update events. Replays the latest update for
 * late subscribers to avoid missing config validation feedback.
 */
export function onServerConfigUpdated(
  listener: (payload: ServerConfigUpdatedPayload) => void,
): () => void {
  serverConfigUpdatedListeners.add(listener);

  const latestConfig =
    instance?.transport.getLatestPush(WS_CHANNELS.serverConfigUpdated)?.data ?? null;
  if (latestConfig) {
    try {
      listener(latestConfig);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    serverConfigUpdatedListeners.delete(listener);
  };
}

/**
 * Subscribe to provider status updates without forcing a full config reload.
 */
export function onServerProviderStatusesUpdated(
  listener: (payload: ServerProviderStatusesUpdatedPayload) => void,
): () => void {
  serverProviderStatusesUpdatedListeners.add(listener);

  const latestProviderStatuses =
    instance?.transport.getLatestPush(WS_CHANNELS.serverProviderStatusesUpdated)?.data ?? null;
  if (latestProviderStatuses) {
    try {
      listener(latestProviderStatuses);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    serverProviderStatusesUpdatedListeners.delete(listener);
  };
}

export function onServerMaintenanceUpdated(
  listener: (payload: ServerLifecycleStreamEvent) => void,
): () => void {
  serverMaintenanceUpdatedListeners.add(listener);

  const latestMaintenance =
    instance?.transport.getLatestPush(WS_CHANNELS.serverMaintenanceUpdated)?.data ?? null;
  if (latestMaintenance) {
    try {
      listener(latestMaintenance);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    serverMaintenanceUpdatedListeners.delete(listener);
  };
}

export function onServerSettingsUpdated(
  listener: (payload: ServerSettingsUpdatedPayload) => void,
): () => void {
  serverSettingsUpdatedListeners.add(listener);

  const latestSettings =
    instance?.transport.getLatestPush(WS_CHANNELS.serverSettingsUpdated)?.data ?? null;
  if (latestSettings) {
    try {
      listener(latestSettings);
    } catch {
      // Swallow listener errors
    }
  }

  return () => {
    serverSettingsUpdatedListeners.delete(listener);
  };
}

export function createWsNativeApi(): NativeApi {
  if (instance) {
    if (instance.transport.getState() !== "disposed") {
      return instance.api;
    }
    instance = null;
  }

  const transport = new WsTransport();
  transport.onStateChange((state) => emitWsTransportState(state));

  transport.subscribe(WS_CHANNELS.serverWelcome, (message) => {
    const payload = message.data;
    for (const listener of welcomeListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.serverConfigUpdated, (message) => {
    const payload = message.data;
    for (const listener of serverConfigUpdatedListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.serverProviderStatusesUpdated, (message) => {
    const payload = message.data;
    for (const listener of serverProviderStatusesUpdatedListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.serverMaintenanceUpdated, (message) => {
    const payload = message.data;
    for (const listener of serverMaintenanceUpdatedListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.serverSettingsUpdated, (message) => {
    const payload = message.data;
    for (const listener of serverSettingsUpdatedListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.gitActionProgress, (message) => {
    const payload = message.data;
    for (const listener of gitActionProgressListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.terminalEvent, (message) => {
    const payload = message.data;
    for (const listener of terminalEventListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(WS_CHANNELS.projectDevServerEvent, (message) => {
    const payload = message.data;
    for (const listener of projectDevServerEventListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(ORCHESTRATION_WS_CHANNELS.domainEvent, (message) => {
    const payload = message.data;
    for (const listener of orchestrationDomainEventListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(ORCHESTRATION_WS_CHANNELS.shellEvent, (message) => {
    const payload = message.data;
    for (const listener of orchestrationShellEventListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  transport.subscribe(ORCHESTRATION_WS_CHANNELS.threadEvent, (message) => {
    const payload = message.data;
    for (const listener of orchestrationThreadEventListeners) {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors
      }
    }
  });
  const api: NativeApi = {
    dialogs: {
      pickFolder: async () => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder();
      },
      saveFile: async (input) => {
        if (window.desktopBridge?.saveFile) {
          return window.desktopBridge.saveFile(input);
        }
        const blob = new Blob([input.contents], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = input.defaultFilename;
          anchor.click();
        } finally {
          URL.revokeObjectURL(url);
        }
        return null;
      },
      confirm: async (message) => {
        return showConfirmDialogFallback(message);
      },
    },
    terminal: {
      open: (input) => transport.request(WS_METHODS.terminalOpen, input),
      write: (input) => transport.request(WS_METHODS.terminalWrite, input),
      ackOutput: (input) => transport.request(WS_METHODS.terminalAckOutput, input),
      resize: (input) => transport.request(WS_METHODS.terminalResize, input),
      clear: (input) => transport.request(WS_METHODS.terminalClear, input),
      restart: (input) => transport.request(WS_METHODS.terminalRestart, input),
      close: (input) => transport.request(WS_METHODS.terminalClose, input),
      onEvent: (callback) => {
        terminalEventListeners.add(callback);
        return () => {
          terminalEventListeners.delete(callback);
        };
      },
    },
    projects: {
      discoverScripts: (input) => transport.request(WS_METHODS.projectsDiscoverScripts, input),
      listDirectories: (input) => transport.request(WS_METHODS.projectsListDirectories, input),
      searchEntries: (input) => transport.request(WS_METHODS.projectsSearchEntries, input),
      searchLocalEntries: (input) =>
        transport.request(WS_METHODS.projectsSearchLocalEntries, input),
      readFile: (input) => transport.request(WS_METHODS.projectsReadFile, input),
      createLocalFilePreviewGrant: (input) =>
        transport.request(WS_METHODS.projectsCreateLocalFilePreviewGrant, input),
      writeFile: (input) => transport.request(WS_METHODS.projectsWriteFile, input),
      runDevServer: (input) => transport.request(WS_METHODS.projectsRunDevServer, input),
      stopDevServer: (input) => transport.request(WS_METHODS.projectsStopDevServer, input),
      listDevServers: () => transport.request(WS_METHODS.projectsListDevServers),
      onDevServerEvent: (callback) => {
        projectDevServerEventListeners.add(callback);
        return () => {
          projectDevServerEventListeners.delete(callback);
        };
      },
    },
    filesystem: {
      browse: (input) => transport.request(WS_METHODS.filesystemBrowse, input),
    },
    research: {
      list: (input = {}) => transport.request(WS_METHODS.researchList, input),
      read: (input) => transport.request(WS_METHODS.researchRead, input),
    },
    shell: {
      openInEditor: (cwd, editor) =>
        transport.request(WS_METHODS.shellOpenInEditor, { cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        // Some mobile browsers can return null here even when the tab opens.
        // Avoid false negatives and let the browser handle popup policy.
        window.open(url, "_blank", "noopener,noreferrer");
      },
      showInFolder: async (path) => {
        if (window.desktopBridge) {
          await window.desktopBridge.showInFolder(path);
        }
        // No-op in browser - this is a desktop-only feature
      },
    },
    git: {
      githubRepository: (input) => transport.request(WS_METHODS.gitGithubRepository, input),
      pull: (input) => transport.request(WS_METHODS.gitPull, input),
      status: (input) => transport.request(WS_METHODS.gitStatus, input),
      readWorkingTreeDiff: (input) => transport.request(WS_METHODS.gitReadWorkingTreeDiff, input),
      summarizeDiff: (input) =>
        transport.request(WS_METHODS.gitSummarizeDiff, input, {
          timeoutMs: null,
        }),
      runStackedAction: (input) =>
        transport.request(WS_METHODS.gitRunStackedAction, input, {
          timeoutMs: null,
        }),
      listBranches: (input) => transport.request(WS_METHODS.gitListBranches, input),
      createWorktree: (input) => transport.request(WS_METHODS.gitCreateWorktree, input),
      createDetachedWorktree: (input) =>
        transport.request(WS_METHODS.gitCreateDetachedWorktree, input),
      removeWorktree: (input) => transport.request(WS_METHODS.gitRemoveWorktree, input),
      deleteBranch: (input) => transport.request(WS_METHODS.gitDeleteBranch, input),
      createBranch: (input) => transport.request(WS_METHODS.gitCreateBranch, input),
      checkout: (input) => transport.request(WS_METHODS.gitCheckout, input),
      stashAndCheckout: (input) => transport.request(WS_METHODS.gitStashAndCheckout, input),
      stashDrop: (input) => transport.request(WS_METHODS.gitStashDrop, input),
      stashInfo: (input) => transport.request(WS_METHODS.gitStashInfo, input),
      removeIndexLock: (input) => transport.request(WS_METHODS.gitRemoveIndexLock, input),
      init: (input) => transport.request(WS_METHODS.gitInit, input),
      stageFiles: (input) => transport.request(WS_METHODS.gitStageFiles, input),
      unstageFiles: (input) => transport.request(WS_METHODS.gitUnstageFiles, input),
      handoffThread: (input) => transport.request(WS_METHODS.gitHandoffThread, input),
      resolvePullRequest: (input) => transport.request(WS_METHODS.gitResolvePullRequest, input),
      pullRequestSnapshot: (input) => transport.request(WS_METHODS.gitPullRequestSnapshot, input),
      preparePullRequestThread: (input) =>
        transport.request(WS_METHODS.gitPreparePullRequestThread, input),
      onActionProgress: (callback) => {
        gitActionProgressListeners.add(callback);
        return () => {
          gitActionProgressListeners.delete(callback);
        };
      },
    },
    workspace: {
      provisionThreadWorktree: (input) =>
        transport.request(WS_METHODS.workspaceProvisionThreadWorktree, input),
      handoffThread: (input) => transport.request(WS_METHODS.workspaceHandoffThread, input),
    },
    github: {
      connection: (input) => transport.request(WS_METHODS.githubConnection, input),
      listWork: (input) => transport.request(WS_METHODS.githubListWork, input),
      workItemDetail: (input) => transport.request(WS_METHODS.githubWorkItemDetail, input),
      pullRequestDiff: (input) => transport.request(WS_METHODS.githubPullRequestDiff, input),
      workItemAction: (input) => transport.request(WS_METHODS.githubWorkItemAction, input),
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position);
        }
        return showContextMenuFallback(items, position);
      },
    },
    server: {
      getConfig: () => transport.request(WS_METHODS.serverGetConfig),
      getEnvironment: () => transport.request(WS_METHODS.serverGetEnvironment),
      getSettings: () => transport.request(WS_METHODS.serverGetSettings),
      updateSettings: (input) => transport.request(WS_METHODS.serverUpdateSettings, input),
      getAuthSession: () => requestAuthJson<AuthSessionState>("/api/auth/session"),
      bootstrapAuth: (input: AuthBootstrapInput) =>
        requestAuthJson<AuthBootstrapResult>("/api/auth/bootstrap", {
          method: "POST",
          body: input,
        }),
      bootstrapBearerAuth: (input: AuthBootstrapInput) =>
        requestAuthJson<AuthBearerBootstrapResult>("/api/auth/bootstrap/bearer", {
          method: "POST",
          body: input,
        }),
      issueAuthWebSocketToken: () =>
        requestAuthJson<AuthWebSocketTokenResult>("/api/auth/ws-token", { method: "POST" }),
      createAuthPairingToken: (input?: AuthCreatePairingCredentialInput) =>
        requestAuthJson<AuthPairingCredentialResult>("/api/auth/pairing-token", {
          method: "POST",
          ...(input ? { body: input } : {}),
        }),
      listAuthPairingLinks: () =>
        requestAuthJson<ReadonlyArray<AuthPairingLink>>("/api/auth/pairing-links"),
      revokeAuthPairingLink: (input: AuthRevokePairingLinkInput) =>
        requestAuthJson<{ revoked: boolean }>("/api/auth/pairing-links/revoke", {
          method: "POST",
          body: input,
        }),
      listAuthClients: () => requestAuthJson<ReadonlyArray<AuthClientSession>>("/api/auth/clients"),
      revokeAuthClient: (input: AuthRevokeClientSessionInput) =>
        requestAuthJson<{ revoked: boolean }>("/api/auth/clients/revoke", {
          method: "POST",
          body: input,
        }),
      revokeOtherAuthClients: () =>
        requestAuthJson<{ revokedCount: number }>("/api/auth/clients/revoke-others", {
          method: "POST",
        }),
      refreshProviders: () => transport.request(WS_METHODS.serverRefreshProviders),
      updateProvider: (input) => transport.request(WS_METHODS.serverUpdateProvider, input),
      listWorktrees: () => transport.request(WS_METHODS.serverListWorktrees),
      listLocalServers: () => transport.request(WS_METHODS.serverListLocalServers),
      stopLocalServer: (input) => transport.request(WS_METHODS.serverStopLocalServer, input),
      getProviderUsageSnapshot: (input) =>
        transport.request(WS_METHODS.serverGetProviderUsageSnapshot, input),
      listProviderUsage: (input) => transport.request(WS_METHODS.serverListProviderUsage, input),
      getDiagnostics: () => transport.request(WS_METHODS.serverGetDiagnostics),
      getPerformanceSnapshot: (input) =>
        transport.request(WS_METHODS.performanceGetSnapshot, input),
      generateThreadRecap: (input) =>
        transport.request(WS_METHODS.serverGenerateThreadRecap, input, {
          timeoutMs: null,
        }),
      generateAutomationIntent: (input) =>
        transport.request(WS_METHODS.serverGenerateAutomationIntent, input, {
          timeoutMs: null,
        }),
      upsertKeybinding: (input) => transport.request(WS_METHODS.serverUpsertKeybinding, input),
    },
    stats: {
      getProfileStats: (input) => transport.request(WS_METHODS.statsGetProfileStats, input),
      getProfileTokenStats: (input) =>
        transport.request(WS_METHODS.statsGetProfileTokenStats, input),
    },
    provider: {
      getComposerCapabilities: (input) =>
        transport.request(WS_METHODS.providerGetComposerCapabilities, input),
      compactThread: (input) => transport.request(WS_METHODS.providerCompactThread, input),
      listCommands: (input) => transport.request(WS_METHODS.providerListCommands, input),
      listSkills: (input) => transport.request(WS_METHODS.providerListSkills, input),
      listSkillsCatalog: (input) => transport.request(WS_METHODS.providerListSkillsCatalog, input),
      listPlugins: (input) => transport.request(WS_METHODS.providerListPlugins, input),
      readPlugin: (input) => transport.request(WS_METHODS.providerReadPlugin, input),
      listModels: (input) => transport.request(WS_METHODS.providerListModels, input),
      listAgents: (input) => transport.request(WS_METHODS.providerListAgents, input),
    },
    orchestration: {
      getSnapshot: () => transport.request(ORCHESTRATION_WS_METHODS.getSnapshot),
      getShellSnapshot: () => transport.request(ORCHESTRATION_WS_METHODS.getShellSnapshot),
      dispatchCommand: (command) => {
        return transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, {
          command: omitNullUserInputAnswers(command),
        });
      },
      listImportableDesktopThreads: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.listImportableDesktopThreads, input),
      importThread: (input) => transport.request(ORCHESTRATION_WS_METHODS.importThread, input),
      repairState: () => transport.request(ORCHESTRATION_WS_METHODS.repairState),
      getTurnDiff: (input) => transport.request(ORCHESTRATION_WS_METHODS.getTurnDiff, input),
      getFullThreadDiff: (input) =>
        transport.request(ORCHESTRATION_WS_METHODS.getFullThreadDiff, input),
      replayEvents: (fromSequenceExclusive) =>
        transport.request(ORCHESTRATION_WS_METHODS.replayEvents, {
          fromSequenceExclusive,
        }),
      subscribeShell: () => transport.request<void>(ORCHESTRATION_WS_METHODS.subscribeShell, {}),
      unsubscribeShell: () =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.unsubscribeShell, {}),
      subscribeThread: (input) =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.subscribeThread, input),
      unsubscribeThread: (input) =>
        transport.request<void>(ORCHESTRATION_WS_METHODS.unsubscribeThread, input),
      onDomainEvent: (callback) => {
        orchestrationDomainEventListeners.add(callback);
        return () => {
          orchestrationDomainEventListeners.delete(callback);
        };
      },
      onShellEvent: (callback) => {
        orchestrationShellEventListeners.add(callback);
        return () => {
          orchestrationShellEventListeners.delete(callback);
        };
      },
      onThreadEvent: (callback) => {
        orchestrationThreadEventListeners.add(callback);
        return () => {
          orchestrationThreadEventListeners.delete(callback);
        };
      },
    },
  };

  instance = { api, transport };
  return api;
}

// Browser-mode tests mount full app roots repeatedly in one page; reset the
// singleton so each test gets a fresh WebSocket stream and cached push state.
export function resetWsNativeApiForTest(): void {
  instance?.transport.dispose();
  instance = null;
  welcomeListeners.clear();
  serverConfigUpdatedListeners.clear();
  serverProviderStatusesUpdatedListeners.clear();
  serverMaintenanceUpdatedListeners.clear();
  serverSettingsUpdatedListeners.clear();
  gitActionProgressListeners.clear();
  terminalEventListeners.clear();
  projectDevServerEventListeners.clear();
  orchestrationDomainEventListeners.clear();
  orchestrationShellEventListeners.clear();
  orchestrationThreadEventListeners.clear();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance?.transport.dispose();
    instance = null;
    welcomeListeners.clear();
    serverConfigUpdatedListeners.clear();
    serverProviderStatusesUpdatedListeners.clear();
    serverSettingsUpdatedListeners.clear();
    gitActionProgressListeners.clear();
    terminalEventListeners.clear();
    projectDevServerEventListeners.clear();
    orchestrationDomainEventListeners.clear();
    orchestrationShellEventListeners.clear();
    orchestrationThreadEventListeners.clear();
  });
}
