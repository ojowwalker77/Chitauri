import { describe, expect, it } from "vitest";

import { selectAppSnapIconEvictions } from "./appSnapIconStore";

describe("AppSnap icon cache", () => {
  it("evicts the least recently updated icons over the limit", () => {
    expect(
      selectAppSnapIconEvictions(
        [
          { bundleIdentifier: "newest", updatedAt: 30 },
          { bundleIdentifier: "oldest", updatedAt: 10 },
          { bundleIdentifier: "middle", updatedAt: 20 },
        ],
        2,
      ),
    ).toEqual(["oldest"]);
  });
});
