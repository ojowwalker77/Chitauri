// FILE: composerImageBlobStore.ts
// Purpose: Stores large composer images outside localStorage with scoped keys and orphan cleanup.
// Layer: Web storage adapter

import {
  awaitIndexedDbRequest,
  openIndexedDbDatabase,
  waitForIndexedDbTransaction,
} from "./indexedDb";

const DATABASE_NAME = "teacode-composer-images";
const DATABASE_VERSION = 1;
const IMAGE_STORE_NAME = "images";
export const COMPOSER_IMAGE_ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

interface StoredComposerImageBlob {
  key: string;
  blob: Blob;
  name: string;
  mimeType: string;
  lastModified: number;
  updatedAt?: number;
}

function openComposerImageDatabase(): Promise<IDBDatabase> {
  return openIndexedDbDatabase({
    name: DATABASE_NAME,
    version: DATABASE_VERSION,
    storeName: IMAGE_STORE_NAME,
    keyPath: "key",
    label: "composer image database",
  });
}

export function composerImageBlobKey(threadId: string, imageId: string): string {
  return `${threadId}:${imageId}`;
}

export async function persistComposerImageBlob(input: {
  threadId: string;
  imageId: string;
  file: File;
}): Promise<string> {
  const key = composerImageBlobKey(input.threadId, input.imageId);
  const database = await openComposerImageDatabase();
  try {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).put({
      key,
      blob: input.file,
      name: input.file.name,
      mimeType: input.file.type,
      lastModified: input.file.lastModified,
      updatedAt: Date.now(),
    } satisfies StoredComposerImageBlob);
    await waitForIndexedDbTransaction(transaction, "Composer image storage");
    return key;
  } finally {
    database.close();
  }
}

export async function readComposerImageBlob(key: string): Promise<File | null> {
  if (key.length === 0) return null;
  const database = await openComposerImageDatabase();
  try {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readonly");
    const completion = waitForIndexedDbTransaction(transaction, "Composer image storage");
    const stored = (await awaitIndexedDbRequest(
      transaction.objectStore(IMAGE_STORE_NAME).get(key),
      "Could not read the composer image.",
    )) as StoredComposerImageBlob | undefined;
    await completion;
    if (!stored?.blob) return null;
    return new File([stored.blob], stored.name, {
      type: stored.mimeType || stored.blob.type,
      lastModified: stored.lastModified,
    });
  } finally {
    database.close();
  }
}

export async function deleteComposerImageBlob(key: string): Promise<void> {
  if (key.length === 0 || typeof indexedDB === "undefined") return;
  const database = await openComposerImageDatabase();
  try {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).delete(key);
    await waitForIndexedDbTransaction(transaction, "Composer image deletion");
  } finally {
    database.close();
  }
}

export function selectOrphanedComposerImageBlobKeys(
  records: ReadonlyArray<{ key: string; updatedAt?: number }>,
  input: {
    isReferenced: (key: string) => boolean;
    nowMs: number;
    minAgeMs?: number;
  },
): string[] {
  const minAgeMs = input.minAgeMs ?? COMPOSER_IMAGE_ORPHAN_MIN_AGE_MS;
  return records
    .filter(
      (record) =>
        !input.isReferenced(record.key) && (record.updatedAt ?? 0) + minAgeMs <= input.nowMs,
    )
    .map((record) => record.key);
}

export async function deleteOrphanedComposerImageBlobs(input: {
  isReferenced: (key: string) => boolean;
  nowMs?: number;
}): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  const database = await openComposerImageDatabase();
  try {
    const readTransaction = database.transaction(IMAGE_STORE_NAME, "readonly");
    const records = (await awaitIndexedDbRequest(
      readTransaction.objectStore(IMAGE_STORE_NAME).getAll(),
      "Could not list composer images.",
    )) as StoredComposerImageBlob[];
    await waitForIndexedDbTransaction(readTransaction, "Composer image listing");

    const keys = selectOrphanedComposerImageBlobKeys(records, {
      isReferenced: input.isReferenced,
      nowMs: input.nowMs ?? Date.now(),
    });
    if (keys.length === 0) return 0;

    const deleteTransaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    const store = deleteTransaction.objectStore(IMAGE_STORE_NAME);
    for (const key of keys) store.delete(key);
    await waitForIndexedDbTransaction(deleteTransaction, "Composer image orphan cleanup");
    return keys.length;
  } finally {
    database.close();
  }
}
