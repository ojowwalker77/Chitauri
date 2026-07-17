import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseReleaseTag, validateReleaseSource } from "./release-preflight.ts";

describe("release preflight", () => {
  it("accepts canonical stable and prerelease tags", () => {
    expect(parseReleaseTag("v1.2.3")).toBe("1.2.3");
    expect(parseReleaseTag("v1.2.3-rc.1")).toBe("1.2.3-rc.1");
    expect(() => parseReleaseTag("1.2.3")).toThrow(/canonical SemVer/);
  });

  it("reports source versions that do not match the tag", () => {
    const root = mkdtempSync(join(tmpdir(), "teacode-preflight-"));
    for (const relativePath of [
      "apps/server/package.json",
      "apps/desktop/package.json",
      "apps/web/package.json",
      "packages/contracts/package.json",
    ]) {
      const directory = join(root, relativePath, "..");
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(root, relativePath),
        JSON.stringify({ version: "1.0.0", productName: "TeaCode" }),
      );
    }
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/build-desktop-artifact.ts"), "");

    expect(validateReleaseSource(root, "v1.0.1")).toContain(
      "apps/server/package.json is 1.0.0; expected 1.0.1",
    );
  });
});
