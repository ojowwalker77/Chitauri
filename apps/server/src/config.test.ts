// FILE: config.test.ts
// Purpose: Verifies pure server configuration path derivation helpers, plus the
//          realpath canonicalization applied to homeDir/chatWorkspaceRoot so reported roots
//          match the REALPATH-canonicalized
//          roots stored on project rows (see wsRpc.ts's
//          canonicalizeProjectWorkspaceRoot).

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveCanonicalWorkspaceRoots,
  resolveDefaultChatWorkspaceRoot,
  resolveStateDirName,
} from "./config";

const tempDirs = new Set<string>();

function makeTempDir(prefix = "synara-config-test-"): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  tempDirs.clear();
});

const runResolveCanonicalWorkspaceRoots = (input: {
  readonly homeDir: string;
  readonly platform?: NodeJS.Platform;
}) =>
  Effect.runPromise(resolveCanonicalWorkspaceRoots(input).pipe(Effect.provide(NodeServices.layer)));

describe("resolveDefaultChatWorkspaceRoot", () => {
  it("places the managed chat workspace under Documents/TeaCode on macOS and Linux", () => {
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "/Users/tester",
        platform: "darwin",
      }),
    ).toBe("/Users/tester/Documents/TeaCode");
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "/home/tester",
        platform: "linux",
      }),
    ).toBe("/home/tester/Documents/TeaCode");
  });

  it("uses Windows separators when deriving the managed chat workspace on Windows", () => {
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "C:\\Users\\tester",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\tester\\Documents\\TeaCode");
  });

  it("defaults to the current process platform when no platform is supplied", () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      expect(resolveDefaultChatWorkspaceRoot({ homeDir: "C:\\Users\\tester" })).toBe(
        "C:\\Users\\tester\\Documents\\TeaCode",
      );
    } finally {
      Object.defineProperty(process, "platform", originalPlatformDescriptor!);
    }
  });
});

describe("resolveCanonicalWorkspaceRoots", () => {
  it("canonicalizes a symlinked home directory to match project row realpaths", async () => {
    const root = makeTempDir();
    const realHome = path.join(root, "real-home");
    fs.mkdirSync(realHome, { recursive: true });
    const symlinkedHome = path.join(root, "home-link");
    fs.symlinkSync(realHome, symlinkedHome, "dir");

    const result = await runResolveCanonicalWorkspaceRoots({
      homeDir: symlinkedHome,
      platform: "darwin",
    });

    const expectedHomeDir = fs.realpathSync(realHome);
    expect(result.homeDir).toBe(expectedHomeDir);
    // chatWorkspaceRoot doesn't exist yet under the resolved home, so it must be re-derived
    // from the canonicalized (symlink-free)
    // home rather than the raw, symlinked input.
    expect(result.chatWorkspaceRoot).toBe(path.join(expectedHomeDir, "Documents", "TeaCode"));
  });

  it("canonicalizes the nearest existing ancestor when the workspace root itself does not exist yet", async () => {
    const root = makeTempDir();
    const realDocuments = path.join(root, "real-documents");
    fs.mkdirSync(realDocuments, { recursive: true });
    const homeDir = path.join(root, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    // Symlink ~/Documents to a real directory elsewhere, matching the bug
    // report scenario (e.g. iCloud-managed Documents on macOS). Neither
    // TeaCode/ does not exist yet underneath it.
    const symlinkedDocuments = path.join(homeDir, "Documents");
    fs.symlinkSync(realDocuments, symlinkedDocuments, "dir");

    const result = await runResolveCanonicalWorkspaceRoots({
      homeDir,
      platform: "darwin",
    });

    const expectedDocuments = fs.realpathSync(realDocuments);
    expect(result.homeDir).toBe(fs.realpathSync(homeDir));
    expect(result.chatWorkspaceRoot).toBe(path.join(expectedDocuments, "TeaCode"));
    expect(fs.existsSync(result.chatWorkspaceRoot)).toBe(false);

    // Once the lazily-created directory shows up on disk, realpath must agree
    // with the previously-reported (pre-creation) canonicalized root.
    fs.mkdirSync(result.chatWorkspaceRoot, { recursive: true });
    expect(fs.realpathSync(result.chatWorkspaceRoot)).toBe(result.chatWorkspaceRoot);
  });
});

describe("resolveStateDirName", () => {
  const devUrl = new URL("http://localhost:5733");

  it("uses the isolated dev namespace when serving from a dev URL", () => {
    expect(resolveStateDirName({ devUrl })).toBe("dev");
  });

  it("uses the production namespace for packaged builds", () => {
    expect(resolveStateDirName({ devUrl: undefined })).toBe("userdata");
  });

  it("lets an explicit override share the production namespace even in dev", () => {
    expect(resolveStateDirName({ devUrl, stateDirNameOverride: "userdata" })).toBe("userdata");
  });

  it("trims a valid override", () => {
    expect(resolveStateDirName({ devUrl, stateDirNameOverride: "  staging  " })).toBe("staging");
  });

  it("ignores unsafe overrides and falls back to the devUrl default", () => {
    for (const unsafe of ["", "   ", ".", "..", "a/b", "../escape", "has space", "weird*name"]) {
      expect(resolveStateDirName({ devUrl, stateDirNameOverride: unsafe })).toBe("dev");
      expect(resolveStateDirName({ devUrl: undefined, stateDirNameOverride: unsafe })).toBe(
        "userdata",
      );
    }
  });
});
