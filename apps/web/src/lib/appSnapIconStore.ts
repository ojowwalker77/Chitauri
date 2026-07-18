// FILE: appSnapIconStore.ts
// Purpose: Keeps bounded AppSnap app icons in IndexedDB rather than composer localStorage.

import {
  awaitIndexedDbRequest,
  openIndexedDbDatabase,
  waitForIndexedDbTransaction,
} from "./indexedDb";
import { normalizeAppSnapIconDataUrl } from "./composerImageSource";

const DATABASE_NAME = "teacode-appsnap-icons";
const STORE_NAME = "icons";
const MAX_ICONS = 100;

interface StoredAppSnapIcon {
  bundleIdentifier: string;
  dataUrl: string;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return openIndexedDbDatabase({
    name: DATABASE_NAME,
    version: 1,
    storeName: STORE_NAME,
    keyPath: "bundleIdentifier",
    label: "AppSnap icon cache",
  });
}

export function selectAppSnapIconEvictions(
  records: ReadonlyArray<Pick<StoredAppSnapIcon, "bundleIdentifier" | "updatedAt">>,
  limit = MAX_ICONS,
): string[] {
  return records
    .toSorted((left, right) => right.updatedAt - left.updatedAt)
    .slice(limit)
    .map((record) => record.bundleIdentifier);
}

export async function persistAppSnapIcon(
  bundleIdentifier: string | null,
  dataUrl: string | null,
): Promise<void> {
  const normalizedIcon = normalizeAppSnapIconDataUrl(dataUrl);
  if (!bundleIdentifier || !normalizedIcon) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put({
      bundleIdentifier,
      dataUrl: normalizedIcon,
      updatedAt: Date.now(),
    } satisfies StoredAppSnapIcon);
    const recordsRequest = store.getAll();
    recordsRequest.addEventListener("success", () => {
      for (const key of selectAppSnapIconEvictions(recordsRequest.result as StoredAppSnapIcon[])) {
        store.delete(key);
      }
    });
    await waitForIndexedDbTransaction(transaction, "AppSnap icon storage");
  } finally {
    database.close();
  }
}

export async function readAppSnapIcon(bundleIdentifier: string | null): Promise<string | null> {
  if (!bundleIdentifier) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const record = (await awaitIndexedDbRequest(
      transaction.objectStore(STORE_NAME).get(bundleIdentifier),
      "Could not read the AppSnap icon.",
    )) as StoredAppSnapIcon | undefined;
    await waitForIndexedDbTransaction(transaction, "AppSnap icon read");
    return normalizeAppSnapIconDataUrl(record?.dataUrl);
  } finally {
    database.close();
  }
}
