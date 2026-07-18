import { describe, expect, it } from "vitest";

import {
  composerImageBlobKey,
  selectOrphanedComposerImageBlobKeys,
} from "./composerImageBlobStore";

describe("composer image blob storage", () => {
  it("scopes image keys to their thread", () => {
    expect(composerImageBlobKey("thread-a", "image-1")).toBe("thread-a:image-1");
  });

  it("only deletes unreferenced records after the safety window", () => {
    expect(
      selectOrphanedComposerImageBlobKeys(
        [
          { key: "referenced", updatedAt: 0 },
          { key: "old-orphan", updatedAt: 0 },
          { key: "new-orphan", updatedAt: 9_500 },
        ],
        {
          isReferenced: (key) => key === "referenced",
          nowMs: 10_000,
          minAgeMs: 1_000,
        },
      ),
    ).toEqual(["old-orphan"]);
  });
});
