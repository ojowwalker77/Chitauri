import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import { toBlob } from "html-to-image";

import type { ComposerImageAttachment } from "~/composerDraftStore";
import {
  cloneSketchpadDocument,
  hasSketchpadContent,
  type SketchpadDocument,
  type SketchpadFrame,
} from "~/lib/composerSketchpad";
import { randomUUID } from "~/lib/utils";

export const SKETCHPAD_EXPORT_MARGIN = 32;
export const SKETCHPAD_EXPORT_MAX_EDGE_PX = 2_048;

export interface SketchpadExportLayout {
  bounds: SketchpadFrame;
  scale: number;
  width: number;
  height: number;
}

export interface ExportedSketchpadSnapshot {
  document: SketchpadDocument;
  image: ComposerImageAttachment;
}

export function getSketchpadContentBounds(document: SketchpadDocument): SketchpadFrame | null {
  if (document.nodes.length === 0) return null;
  const minX = Math.min(...document.nodes.map((node) => node.frame.x));
  const minY = Math.min(...document.nodes.map((node) => node.frame.y));
  const maxX = Math.max(...document.nodes.map((node) => node.frame.x + node.frame.width));
  const maxY = Math.max(...document.nodes.map((node) => node.frame.y + node.frame.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function resolveSketchpadExportLayout(
  document: SketchpadDocument,
): SketchpadExportLayout | null {
  const contentBounds = getSketchpadContentBounds(document);
  if (!contentBounds) return null;
  const bounds = {
    x: contentBounds.x - SKETCHPAD_EXPORT_MARGIN,
    y: contentBounds.y - SKETCHPAD_EXPORT_MARGIN,
    width: contentBounds.width + SKETCHPAD_EXPORT_MARGIN * 2,
    height: contentBounds.height + SKETCHPAD_EXPORT_MARGIN * 2,
  };
  // html-to-image renders at 2x below. Scale the CSS artwork so its resulting
  // longest bitmap edge remains bounded even for a very spread-out sketch.
  const scale = Math.min(
    1,
    SKETCHPAD_EXPORT_MAX_EDGE_PX / (Math.max(bounds.width, bounds.height) * 2),
  );
  return {
    bounds,
    scale,
    width: Math.max(1, Math.ceil(bounds.width * scale)),
    height: Math.max(1, Math.ceil(bounds.height * scale)),
  };
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Invalid PNG data.")),
    );
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Could not read PNG data.")),
    );
    reader.readAsDataURL(blob);
  });
}

async function renderSketchpadBlob(element: HTMLElement, pixelRatio: number): Promise<Blob | null> {
  try {
    return await toBlob(element, {
      pixelRatio,
      cacheBust: true,
      backgroundColor: "#ffffff",
      width: element.offsetWidth,
      height: element.offsetHeight,
    });
  } catch {
    return null;
  }
}

export async function exportSketchpadSnapshot(input: {
  element: HTMLElement;
  document: SketchpadDocument;
  existingAttachmentCount: number;
}): Promise<ExportedSketchpadSnapshot> {
  if (!hasSketchpadContent(input.document)) {
    throw new Error("Add something to the sketchpad before sending it.");
  }
  if (input.existingAttachmentCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    throw new Error(
      `The sketch needs one attachment slot. Remove a reference to stay within the ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}-attachment limit.`,
    );
  }
  let blob = await renderSketchpadBlob(input.element, 2);
  if (!blob) {
    throw new Error(
      "TeaCode could not render the sketchpad. Your sketch is still in the composer.",
    );
  }
  if (blob.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    blob = await renderSketchpadBlob(input.element, 1);
  }
  if (!blob || blob.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    throw new Error("The sketchpad PNG is larger than 10MB. Simplify the sketch and try again.");
  }
  const file = new File([blob], "sketchpad.png", { type: "image/png" });
  const previewUrl = await readBlobAsDataUrl(blob);
  return {
    document: cloneSketchpadDocument(input.document),
    image: {
      type: "image",
      id: randomUUID(),
      name: "sketchpad.png",
      mimeType: "image/png",
      sizeBytes: blob.size,
      previewUrl,
      file,
    },
  };
}
