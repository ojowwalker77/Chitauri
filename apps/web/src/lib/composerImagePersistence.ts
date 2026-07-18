// FILE: composerImagePersistence.ts
// Purpose: Stages composer images into durable blob storage before publishing localStorage metadata.
// Layer: Web composer persistence

import type {
  ComposerAttachmentPersistenceResult,
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "../composerDraftStore";
import { persistComposerImageBlob } from "./composerImageBlobStore";
import { toPersistedComposerImageSource } from "./composerImageSource";
import { readFileAsDataUrl } from "./composerSend";

export async function stageComposerImageAttachments(input: {
  threadId: string;
  images: ReadonlyArray<ComposerImageAttachment>;
  existing: ReadonlyArray<PersistedComposerImageAttachment>;
  sync: (
    attachments: PersistedComposerImageAttachment[],
  ) => Promise<ComposerAttachmentPersistenceResult>;
}): Promise<ComposerAttachmentPersistenceResult> {
  const existingById = new Map(input.existing.map((attachment) => [attachment.id, attachment]));
  const staged = await Promise.all(
    input.images.map(async (image): Promise<PersistedComposerImageAttachment | null> => {
      const existing = existingById.get(image.id);
      if (existing?.blobKey || existing?.dataUrl) return existing;

      const source = toPersistedComposerImageSource(image.source);
      const base = {
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        ...(source ? { source } : {}),
      };

      try {
        const blobKey = await persistComposerImageBlob({
          threadId: input.threadId,
          imageId: image.id,
          file: image.file,
        });
        return { ...base, blobKey };
      } catch {
        try {
          return { ...base, dataUrl: await readFileAsDataUrl(image.file) };
        } catch {
          return existing ?? null;
        }
      }
    }),
  );

  return input.sync(staged.filter((entry): entry is PersistedComposerImageAttachment => !!entry));
}
