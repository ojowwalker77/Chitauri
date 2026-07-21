import { describe, expect, it } from "vitest";

import { createDesktopStaticFileResponse } from "./desktopStaticProtocol";

describe("createDesktopStaticFileResponse", () => {
  it("prevents Chromium from reusing renderer assets across desktop updates", () => {
    expect(createDesktopStaticFileResponse("/app/index.html")).toEqual({
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Expires: "0",
        Pragma: "no-cache",
      },
      path: "/app/index.html",
    });
  });
});
