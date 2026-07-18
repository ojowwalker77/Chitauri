import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SketchpadDocument } from "~/lib/composerSketchpad";
import {
  exportSketchpadSnapshot,
  getSketchpadContentBounds,
  resolveSketchpadExportLayout,
} from "./sketchpadExport";

const { toBlobMock } = vi.hoisted(() => ({ toBlobMock: vi.fn() }));

vi.mock("html-to-image", () => ({ toBlob: toBlobMock }));

const document: SketchpadDocument = {
  version: 1,
  revision: 1,
  nodes: [
    {
      id: "a",
      kind: "note",
      text: "A",
      frame: { x: -20, y: 10, width: 100, height: 60 },
      author: "user",
    },
    {
      id: "b",
      kind: "shape",
      shape: "rectangle",
      label: "B",
      frame: { x: 220, y: 160, width: 80, height: 40 },
      author: "user",
    },
  ],
  edges: [],
};

describe("sketchpadExport", () => {
  beforeEach(() => {
    toBlobMock.mockReset();
  });

  it("computes content bounds and adds a stable margin", () => {
    expect(getSketchpadContentBounds(document)).toEqual({ x: -20, y: 10, width: 320, height: 190 });
    expect(resolveSketchpadExportLayout(document)).toMatchObject({
      bounds: { x: -52, y: -22, width: 384, height: 254 },
      scale: 1,
      width: 384,
      height: 254,
    });
  });

  it("scales spread-out documents to a safe output edge", () => {
    const spread = {
      ...document,
      nodes: [{ ...document.nodes[0]!, frame: { x: 0, y: 0, width: 10_000, height: 100 } }],
    };
    const layout = resolveSketchpadExportLayout(spread);
    expect((layout?.width ?? Infinity) * 2).toBeLessThanOrEqual(2_050);
  });

  it("reserves one ordinary attachment slot for the PNG", async () => {
    await expect(
      exportSketchpadSnapshot({
        element: documentElement(),
        document,
        existingAttachmentCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
      }),
    ).rejects.toThrow("one attachment slot");
    expect(toBlobMock).not.toHaveBeenCalled();
  });

  it("retries an oversized 2x export at 1x before failing", async () => {
    const oversizedBlob = new Blob([new Uint8Array(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1)], {
      type: "image/png",
    });
    toBlobMock.mockResolvedValueOnce(oversizedBlob).mockResolvedValueOnce(oversizedBlob);

    await expect(
      exportSketchpadSnapshot({
        element: documentElement(),
        document,
        existingAttachmentCount: 0,
      }),
    ).rejects.toThrow("larger than 10MB");
    expect(toBlobMock.mock.calls.map((call) => call[1]?.pixelRatio)).toEqual([2, 1]);
  });
});

function documentElement(): HTMLElement {
  return { offsetWidth: 384, offsetHeight: 254 } as HTMLElement;
}
