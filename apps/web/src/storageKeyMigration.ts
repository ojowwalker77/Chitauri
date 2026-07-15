// FILE: storageKeyMigration.ts
// Purpose: Migrates legacy browser storage keys to the Chitauri namespace.
// Layer: Web bootstrap utility
// Exports: migrateChitauriLocalStorageKeys

const STORAGE_KEY_MIGRATIONS = [
  ["dpcode:renderer-state:v8", "chitauri:renderer-state:v8"],
  ["t3code:renderer-state:v8", "chitauri:renderer-state:v8"],
  ["dpcode:composer-drafts:v1", "chitauri:composer-drafts:v1"],
  ["t3code:composer-drafts:v1", "chitauri:composer-drafts:v1"],
  ["dpcode:split-view-state:v1", "chitauri:split-view-state:v1"],
  ["t3code:split-view-state:v1", "chitauri:split-view-state:v1"],
  ["dpcode:sidebar-ui:v1", "chitauri:sidebar-ui:v1"],
  ["t3code:sidebar-ui:v1", "chitauri:sidebar-ui:v1"],
  ["dpcode:single-chat-panel-state:v1", "chitauri:single-chat-panel-state:v1"],
  ["t3code:single-chat-panel-state:v1", "chitauri:single-chat-panel-state:v1"],
  ["dpcode:terminal-state:v1", "chitauri:terminal-state:v1"],
  ["t3code:terminal-state:v1", "chitauri:terminal-state:v1"],
  ["dpcode:latest-project:v1", "chitauri:latest-project:v1"],
  ["t3code:latest-project:v1", "chitauri:latest-project:v1"],
  ["dpcode:app-settings:v1", "chitauri:app-settings:v1"],
  ["t3code:app-settings:v1", "chitauri:app-settings:v1"],
  ["dpcode:pinned-threads:v1", "chitauri:pinned-threads:v1"],
  ["t3code:pinned-threads:v1", "chitauri:pinned-threads:v1"],
  ["dpcode:browser-state:v1", "chitauri:browser-state:v1"],
  ["t3code:browser-state:v1", "chitauri:browser-state:v1"],
  ["dpcode:workspace-pages:v2", "chitauri:workspace-pages:v2"],
  ["t3code:workspace-pages:v2", "chitauri:workspace-pages:v2"],
  ["dpcode:theme", "chitauri:theme"],
  ["t3code:theme", "chitauri:theme"],
  ["dpcode:last-editor", "chitauri:last-editor"],
  ["t3code:last-editor", "chitauri:last-editor"],
  ["dpcode:last-invoked-script-by-project", "chitauri:last-invoked-script-by-project"],
  ["t3code:last-invoked-script-by-project", "chitauri:last-invoked-script-by-project"],
  ["dpcode:right-dock-state:v1", "chitauri:right-dock-state:v1"],
  ["dpcode:repo-diff-scope:v1", "chitauri:repo-diff-scope:v1"],
  ["dpcode:feature-flags", "chitauri:feature-flags"],
  ["dpcode:whats-new:v1", "chitauri:whats-new:v1"],
  ["dpcode:dismissed-provider-health-banners", "chitauri:dismissed-provider-health-banners"],
  ["dpcode:show-debug-feature-flags-menu", "chitauri:show-debug-feature-flags-menu"],
  ["dpcode:cursor-favourite-models:v1", "chitauri:cursor-favourite-models:v1"],
  ["dpcode:kilo-favourite-models:v1", "chitauri:kilo-favourite-models:v1"],
  ["dpcode:opencode-favourite-models:v1", "chitauri:opencode-favourite-models:v1"],
  ["dpcode:pi-favourite-models:v1", "chitauri:pi-favourite-models:v1"],
  ["dpcode:browser-perf", "chitauri:browser-perf"],
  ["t3code:browser-perf", "chitauri:browser-perf"],
] as const;

export function migrateChitauriLocalStorageKeys(): void {
  // Prefer globalThis.localStorage so this works identically in browsers (where
  // globalThis === window) and in node-based unit tests that stub the global.
  let storage: Storage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    return;
  }
  if (!storage) {
    return;
  }

  try {
    const legacyChitauriKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("synara:") || key?.startsWith("synara.")) {
        legacyChitauriKeys.push(key);
      }
    }

    for (const legacyKey of legacyChitauriKeys) {
      const nextKey = legacyKey.replace(/^synara(?=[:.])/, "chitauri");
      if (storage.getItem(nextKey) === null) {
        const legacyValue = storage.getItem(legacyKey);
        if (legacyValue !== null) {
          storage.setItem(nextKey, legacyValue);
        }
      }
    }

    for (const [legacyKey, nextKey] of STORAGE_KEY_MIGRATIONS) {
      if (storage.getItem(nextKey) !== null) {
        continue;
      }
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue !== null) {
        storage.setItem(nextKey, legacyValue);
      }
    }
  } catch {
    // Storage can be unavailable in private/sandboxed contexts; the app should still boot.
  }
}

// Run during bootstrap before stores hydrate from localStorage.
migrateChitauriLocalStorageKeys();
