import * as fs from "node:fs/promises";
import OS from "node:os";
import * as nodePath from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { encodeFingerprint, fingerprintDirectory, fingerprintMatches } from "./safety";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => fs.rm(path, { force: true, recursive: true })),
  );
});

describe("Computer Scripts tree fingerprints", () => {
  it("rejects a directory whose nested contents changed after analysis", async () => {
    const root = await fs.mkdtemp(nodePath.join(OS.tmpdir(), "chitauri-computer-scripts-"));
    temporaryDirectories.push(root);
    const target = nodePath.join(root, "node_modules");
    const nestedFile = nodePath.join(target, "package", "index.js");
    await fs.mkdir(nodePath.dirname(nestedFile), { recursive: true });
    await fs.writeFile(nestedFile, "before");

    const beforeRootStat = await fs.lstat(target);
    const analyzed = await fingerprintDirectory(target);
    expect(analyzed).not.toBeNull();
    const encoded = encodeFingerprint(analyzed!);

    await fs.writeFile(nestedFile, "changed after analysis");

    const afterRootStat = await fs.lstat(target);
    const current = await fingerprintDirectory(target);
    expect(afterRootStat.mtimeMs).toBe(beforeRootStat.mtimeMs);
    expect(afterRootStat.size).toBe(beforeRootStat.size);
    expect(current).not.toBeNull();
    expect(fingerprintMatches(current!, encoded)).toBe(false);
  });
});
