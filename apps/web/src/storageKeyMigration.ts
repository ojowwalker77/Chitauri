// FILE: storageKeyMigration.ts
// Purpose: Migrates legacy browser storage keys to the TeaCode namespace.
// Layer: Web bootstrap utility
// Exports: migrateTeaCodeLocalStorageKeys

const LEGACY_STORAGE_PREFIXES = ["chitauri", "dpcode", "t3code", "synara"] as const;

export function migrateTeaCodeLocalStorageKeys(): void {
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
    const legacyKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (
        LEGACY_STORAGE_PREFIXES.some(
          (prefix) => key?.startsWith(`${prefix}:`) || key?.startsWith(`${prefix}.`),
        )
      ) {
        legacyKeys.push(key);
      }
    }
    legacyKeys.sort((left, right) => {
      const leftPriority = LEGACY_STORAGE_PREFIXES.findIndex((prefix) => left.startsWith(prefix));
      const rightPriority = LEGACY_STORAGE_PREFIXES.findIndex((prefix) => right.startsWith(prefix));
      return leftPriority - rightPriority;
    });

    for (const legacyKey of legacyKeys) {
      const nextKey = legacyKey.replace(/^(chitauri|dpcode|t3code|synara)(?=[:.])/, "teacode");
      if (storage.getItem(nextKey) === null) {
        const legacyValue = storage.getItem(legacyKey);
        if (legacyValue !== null) {
          storage.setItem(nextKey, legacyValue);
        }
      }
    }
  } catch {
    // Storage can be unavailable in private/sandboxed contexts; the app should still boot.
  }
}

// Run during bootstrap before stores hydrate from localStorage.
migrateTeaCodeLocalStorageKeys();
