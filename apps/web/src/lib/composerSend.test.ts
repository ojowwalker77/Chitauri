import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildComposerFileAttachmentsFromFiles,
  buildComposerImageAttachmentsFromFiles,
  effectiveComposerAttachmentCount,
  findPendingBlobComposerAttachments,
} from "./composerSend";
import { createEmptySketchpadDocument } from "./composerSketchpad";

describe("composerSend attachment builders", () => {
  const originalCreateObjectUrl = URL.createObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn((file: Blob) => `blob:${(file as File).name}`);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
  });

  it("keeps image-specific unsupported-file errors while sharing cap handling", () => {
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const imageFile = new File(["png"], "screen.png", { type: "image/png" });

    const result = buildComposerImageAttachmentsFromFiles({
      files: [textFile, imageFile],
      existingAttachmentCount: 0,
    });

    expect(result.error).toBe(
      "Unsupported file type for 'notes.txt'. Please attach image files only.",
    );
    expect(result.images).toEqual([
      expect.objectContaining({
        type: "image",
        name: "screen.png",
        mimeType: "image/png",
        previewUrl: "blob:screen.png",
      }),
    ]);
  });

  it("builds generic file attachments and skips images without an error", () => {
    const imageFile = new File(["png"], "screen.png", { type: "image/png" });
    const unknownFile = new File(["data"], "payload.bin", { type: "" });

    const result = buildComposerFileAttachmentsFromFiles({
      files: [imageFile, unknownFile],
      existingAttachmentCount: 0,
    });

    expect(result.error).toBeNull();
    expect(result.files).toEqual([
      expect.objectContaining({
        type: "file",
        name: "payload.bin",
        mimeType: "application/octet-stream",
        sizeBytes: unknownFile.size,
        file: unknownFile,
      }),
    ]);
  });

  it("enforces the shared attachment count cap for generic files", () => {
    const result = buildComposerFileAttachmentsFromFiles({
      files: [new File(["data"], "notes.txt", { type: "text/plain" })],
      existingAttachmentCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
    });

    expect(result.files).toEqual([]);
    expect(result.error).toBe(
      `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
    );
  });

  it("counts durable images that have not hydrated yet", () => {
    const sketchpad = createEmptySketchpadDocument();
    sketchpad.nodes.push({
      id: "note-1",
      kind: "note",
      text: "Sketch",
      frame: { x: 0, y: 0, width: 160, height: 90 },
      author: "user",
    });

    expect(
      effectiveComposerAttachmentCount({
        images: [{ id: "hydrated" }],
        files: [{}],
        assistantSelections: [{}],
        persistedAttachments: [{ id: "hydrated" }, { id: "pending" }],
        sketchpad,
      }),
    ).toBe(5);
  });

  it("finds only pending IndexedDB-backed images", () => {
    expect(
      findPendingBlobComposerAttachments({
        images: [
          {
            id: "hydrated",
            type: "image",
            name: "hydrated.png",
            mimeType: "image/png",
            sizeBytes: 1,
            previewUrl: "blob:hydrated",
            file: new File([], "hydrated.png"),
          },
        ],
        persistedAttachments: [
          {
            id: "hydrated",
            name: "hydrated.png",
            mimeType: "image/png",
            sizeBytes: 1,
            blobKey: "thread:hydrated",
          },
          {
            id: "pending",
            name: "pending.png",
            mimeType: "image/png",
            sizeBytes: 1,
            blobKey: "thread:pending",
          },
          {
            id: "legacy-data-url",
            name: "legacy.png",
            mimeType: "image/png",
            sizeBytes: 1,
            dataUrl: "data:image/png;base64,aQ==",
          },
        ],
      }),
    ).toEqual([expect.objectContaining({ id: "pending", blobKey: "thread:pending" })]);
  });
});
