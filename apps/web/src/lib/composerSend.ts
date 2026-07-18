// FILE: composerSend.ts
// Purpose: Shared composer send helpers for attachment intake, prompt formatting, and upload payloads.
// Layer: Web composer utility
// Depends on: provider/model contracts plus composer draft attachment shapes.

import {
  MessageId,
  type ModelSelection,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ClaudeCodeEffort,
  type ProviderKind,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix, getModelCapabilities } from "@t3tools/shared/model";

import type {
  ComposerAssistantSelectionAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
  PersistedComposerImageAttachment,
} from "../composerDraftStore";
import { readComposerImageBlob } from "./composerImageBlobStore";
import { normalizeComposerImageSource } from "./composerImageSource";
import { randomUUID } from "./utils";

export const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024),
)}MB`;
export const FILE_SIZE_LIMIT_LABEL = `${Math.round(
  PROVIDER_SEND_TURN_MAX_FILE_BYTES / (1024 * 1024),
)}MB`;

export interface ComposerImageBuildResult {
  images: ComposerImageAttachment[];
  error: string | null;
}

export interface ComposerFileBuildResult {
  files: ComposerFileAttachment[];
  error: string | null;
}

// Centralizes the shared file/count/size guard while each attachment type maps its own draft shape.
function collectComposerAttachmentFiles(input: {
  files: readonly File[];
  existingAttachmentCount: number;
  maxBytes: number;
  sizeLimitLabel: string;
  acceptsFile: (file: File) => boolean;
  unsupportedFileError?: (file: File) => string | null;
}): { files: File[]; error: string | null } {
  const files: File[] = [];
  let nextAttachmentCount = input.existingAttachmentCount;
  let error: string | null = null;

  for (const file of input.files) {
    if (!input.acceptsFile(file)) {
      error = input.unsupportedFileError?.(file) ?? error;
      continue;
    }
    if (file.size > input.maxBytes) {
      error = `'${file.name}' exceeds the ${input.sizeLimitLabel} attachment limit.`;
      continue;
    }
    if (nextAttachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`;
      break;
    }

    files.push(file);
    nextAttachmentCount += 1;
  }

  return { files, error };
}

// Converts File objects into the exact attachment draft shape used by the chat composer.
export function buildComposerImageAttachmentsFromFiles(input: {
  files: readonly File[];
  existingAttachmentCount: number;
}): ComposerImageBuildResult {
  const result = collectComposerAttachmentFiles({
    files: input.files,
    existingAttachmentCount: input.existingAttachmentCount,
    maxBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
    sizeLimitLabel: IMAGE_SIZE_LIMIT_LABEL,
    acceptsFile: (file) => file.type.startsWith("image/"),
    unsupportedFileError: (file) =>
      `Unsupported file type for '${file.name}'. Please attach image files only.`,
  });

  const images = result.files.map<ComposerImageAttachment>((file) => ({
    type: "image",
    id: randomUUID(),
    name: file.name || "image",
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    file,
  }));

  return { images, error: result.error };
}

// Converts non-image File objects into in-memory file attachment drafts.
export function buildComposerFileAttachmentsFromFiles(input: {
  files: readonly File[];
  existingAttachmentCount: number;
}): ComposerFileBuildResult {
  const result = collectComposerAttachmentFiles({
    files: input.files,
    existingAttachmentCount: input.existingAttachmentCount,
    maxBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES,
    sizeLimitLabel: FILE_SIZE_LIMIT_LABEL,
    acceptsFile: (file) => !file.type.startsWith("image/"),
  });

  const files = result.files.map<ComposerFileAttachment>((file) => ({
    type: "file",
    id: randomUUID(),
    name: file.name || "attachment",
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    file,
  }));

  return { files, error: result.error };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read attachment data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read attachment."));
    });
    reader.readAsDataURL(file);
  });
}

export function cloneComposerImageAttachment(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

// Provider-specific prompt massaging. Claude prompt-injected efforts must be
// applied before filtering skill/mention references and before dispatch.
export function formatOutgoingComposerPrompt(params: {
  provider: ProviderKind;
  model: string | null;
  effort: string | null;
  text: string;
}): string {
  const caps = getModelCapabilities(params.provider, params.model);
  if (params.effort && caps.promptInjectedEffortLevels.includes(params.effort)) {
    return applyClaudePromptEffortPrefix(params.text, params.effort as ClaudeCodeEffort | null);
  }
  return params.text;
}

export function resolvePromptEffortFromModelSelection(
  modelSelection: ModelSelection,
): string | null {
  switch (modelSelection.provider) {
    case "codex":
      return modelSelection.options?.reasoningEffort ?? null;
    case "claudeAgent":
      return modelSelection.options?.effort ?? null;
    case "cursor":
      return modelSelection.options?.reasoningEffort ?? null;
    case "grok":
      return modelSelection.options?.reasoningEffort ?? null;
    case "pi":
      return modelSelection.options?.thinkingLevel ?? null;
    case "kilo":
    case "opencode":
      return null;
  }
}

export async function buildUploadComposerAttachments(input: {
  images: ReadonlyArray<ComposerImageAttachment>;
  files?: ReadonlyArray<ComposerFileAttachment>;
  assistantSelections: ReadonlyArray<ComposerAssistantSelectionAttachment>;
}): Promise<UploadChatAttachment[]> {
  return Promise.all([
    ...input.assistantSelections.map((selection) =>
      Promise.resolve({
        type: "assistant-selection" as const,
        assistantMessageId: MessageId.makeUnsafe(selection.assistantMessageId),
        text: selection.text,
      }),
    ),
    ...input.images.map(async (image) => ({
      type: "image" as const,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: await readFileAsDataUrl(image.file),
    })),
    ...(input.files ?? []).map(async (file) => ({
      type: "file" as const,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      dataUrl: await readFileAsDataUrl(file.file),
    })),
  ]);
}

interface AttachmentIdCarrier {
  id: string;
}

interface EffectiveComposerAttachmentCountDraft {
  images?: ReadonlyArray<AttachmentIdCarrier>;
  files?: ReadonlyArray<unknown>;
  assistantSelections?: ReadonlyArray<unknown>;
  persistedAttachments?: ReadonlyArray<AttachmentIdCarrier>;
}

export function effectiveComposerAttachmentCount(
  draft: EffectiveComposerAttachmentCountDraft | undefined,
): number {
  if (!draft) return 0;
  const hydratedImageIds = new Set((draft.images ?? []).map((image) => image.id));
  const pendingPersistedCount = (draft.persistedAttachments ?? []).filter(
    (attachment) => !hydratedImageIds.has(attachment.id),
  ).length;
  return (
    (draft.images?.length ?? 0) +
    (draft.files?.length ?? 0) +
    (draft.assistantSelections?.length ?? 0) +
    pendingPersistedCount
  );
}

export function findPendingBlobComposerAttachments(input: {
  persistedAttachments: ReadonlyArray<PersistedComposerImageAttachment>;
  images: ReadonlyArray<ComposerImageAttachment>;
}): PersistedComposerImageAttachment[] {
  const hydratedImageIds = new Set(input.images.map((image) => image.id));
  return input.persistedAttachments.filter(
    (attachment) => Boolean(attachment.blobKey) && !hydratedImageIds.has(attachment.id),
  );
}

export async function hydratePendingBlobComposerAttachments(
  pending: ReadonlyArray<PersistedComposerImageAttachment>,
): Promise<ComposerImageAttachment[]> {
  const hydrated = await Promise.all(
    pending.map(async (attachment): Promise<ComposerImageAttachment | null> => {
      if (!attachment.blobKey) return null;
      try {
        const file = await readComposerImageBlob(attachment.blobKey);
        if (!file) return null;
        const source = normalizeComposerImageSource(attachment.source);
        return {
          type: "image",
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          previewUrl: URL.createObjectURL(file),
          file,
          ...(source ? { source } : {}),
        };
      } catch (error) {
        console.warn("[composer] Could not hydrate a pending image before send", error);
        return null;
      }
    }),
  );
  return hydrated.filter((image): image is ComposerImageAttachment => image !== null);
}
