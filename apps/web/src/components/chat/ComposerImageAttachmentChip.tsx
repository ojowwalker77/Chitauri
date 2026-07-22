// FILE: ComposerImageAttachmentChip.tsx
// Purpose: Renders composer image attachments as rounded square thumbnails with preview/remove actions.
// Layer: Chat composer presentation
// Depends on: composer draft image metadata, shared chip styles, and expanded image preview helpers.

import { memo } from "react";
import { type ComposerImageAttachment } from "../../composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AttachmentRemoveButton } from "./AttachmentRemoveButton";
import {
  DRAFT_ATTACHMENT_WARNING_DESCRIPTION,
  DraftAttachmentWarningIcon,
} from "./DraftAttachmentWarning";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";

interface ComposerImageAttachmentChipProps {
  image: ComposerImageAttachment;
  images: readonly ComposerImageAttachment[];
  nonPersisted: boolean;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onRemoveImage: (imageId: string) => void;
}

export const ComposerImageAttachmentChip = memo(function ComposerImageAttachmentChip({
  image,
  images,
  nonPersisted,
  onExpandImage,
  onRemoveImage,
}: ComposerImageAttachmentChipProps) {
  const previewImage = () => {
    const preview = buildExpandedImagePreview(images, image.id);
    if (preview) onExpandImage(preview);
  };

  if (image.source?.kind === "appsnap") {
    const sourceTitle = image.source.windowTitle || image.source.appName || "Captured window";
    return (
      <div className="group relative w-64 shrink-0">
        <button
          type="button"
          className="flex h-16 w-full overflow-hidden rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] text-left transition-colors hover:border-[color:var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Preview ${image.name}`}
          onClick={previewImage}
        >
          <div className="size-16 shrink-0 overflow-hidden border-r border-[color:var(--color-border-light)]">
            <img src={image.previewUrl} alt={image.name} className="size-full object-cover" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 pr-8">
            {image.source.appIconDataUrl ? (
              <img
                src={image.source.appIconDataUrl}
                alt=""
                className="size-5 shrink-0 rounded-md"
              />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                {(image.source.appName || "A").slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-foreground">
                {sourceTitle}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {image.source.appName || "AppSnap"}
              </span>
            </span>
          </div>
        </button>
        {nonPersisted && (
          <Tooltip>
            <TooltipTrigger
              render={
                <DraftAttachmentWarningIcon variant="badge" className="absolute bottom-1 left-1" />
              }
            />
            <TooltipPopup side="top" className="max-w-64 whitespace-normal leading-tight">
              {DRAFT_ATTACHMENT_WARNING_DESCRIPTION}
            </TooltipPopup>
          </Tooltip>
        )}
        <AttachmentRemoveButton
          size="md"
          label={`Remove ${image.name}`}
          onRemove={() => onRemoveImage(image.id)}
        />
      </div>
    );
  }

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        className="block size-16 overflow-hidden rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] transition-colors hover:border-[color:var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Preview ${image.name}`}
        title={image.name}
        onClick={previewImage}
      >
        {image.previewUrl ? (
          <img src={image.previewUrl} alt={image.name} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-xs font-medium text-muted-foreground">
            IMG
          </span>
        )}
      </button>

      {nonPersisted && (
        <Tooltip>
          <TooltipTrigger
            render={
              <DraftAttachmentWarningIcon variant="badge" className="absolute bottom-1 left-1" />
            }
          />
          <TooltipPopup side="top" className="max-w-64 whitespace-normal leading-tight">
            {DRAFT_ATTACHMENT_WARNING_DESCRIPTION}
          </TooltipPopup>
        </Tooltip>
      )}

      <AttachmentRemoveButton
        size="md"
        label={`Remove ${image.name}`}
        onRemove={() => onRemoveImage(image.id)}
      />
    </div>
  );
});
