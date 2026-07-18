import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerImageAttachmentChip } from "./ComposerImageAttachmentChip";

describe("ComposerImageAttachmentChip", () => {
  it("renders a compact thumbnail with preview and remove actions", () => {
    const markup = renderToStaticMarkup(
      <ComposerImageAttachmentChip
        image={{
          id: "image-1",
          type: "image",
          name: "CleanShot 2026-04-11 at 20.00.33@2x.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          previewUrl: "blob:image-1",
          file: new File(["image"], "CleanShot 2026-04-11 at 20.00.33@2x.png", {
            type: "image/png",
          }),
        }}
        images={[
          {
            id: "image-1",
            type: "image",
            name: "CleanShot 2026-04-11 at 20.00.33@2x.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            previewUrl: "blob:image-1",
            file: new File(["image"], "CleanShot 2026-04-11 at 20.00.33@2x.png", {
              type: "image/png",
            }),
          },
        ]}
        nonPersisted={false}
        onExpandImage={() => {}}
        onRemoveImage={() => {}}
      />,
    );

    expect(markup).toContain("CleanShot 2026-04-11 at 20.00.33@2x.png");
    expect(markup).toContain("size-16");
    expect(markup).toContain("Preview CleanShot 2026-04-11 at 20.00.33@2x.png");
    expect(markup).toContain("Remove CleanShot 2026-04-11 at 20.00.33@2x.png");
    expect(markup).not.toContain("h-14 w-14");
  });

  it("renders TeaCode AppSnap provenance as a reviewable capture card", () => {
    const image = {
      id: "capture-1",
      type: "image" as const,
      name: "AppSnap-Safari.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      previewUrl: "blob:capture-1",
      file: new File(["image"], "AppSnap-Safari.png", { type: "image/png" }),
      source: {
        kind: "appsnap" as const,
        captureId: "capture-1",
        capturedAt: "2026-07-17T00:00:00.000Z",
        appName: "Safari",
        appIconDataUrl: "data:image/png;base64,aWNvbg==",
        windowTitle: "TeaCode research",
      },
    };
    const markup = renderToStaticMarkup(
      <ComposerImageAttachmentChip
        image={image}
        images={[image]}
        nonPersisted={false}
        onExpandImage={() => {}}
        onRemoveImage={() => {}}
      />,
    );

    expect(markup).toContain("TeaCode research");
    expect(markup).toContain("Safari");
    expect(markup).toContain("w-64");
    expect(markup).toContain("data:image/png;base64,aWNvbg==");
  });
});
