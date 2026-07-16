// FILE: browserUsePipeServer.test.ts
// Purpose: Guards the desktop browser-use native pipe path helpers.
// Layer: Desktop test
// Depends on: Vitest and browserUsePipeServer path resolution exports

import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  CHITAURI_BROWSER_USE_PIPE_ENV,
  resolveConfiguredBrowserUsePipePath,
  resolveDefaultBrowserUsePipePath,
} from "./browserUsePipeServer";

describe("browser-use pipe path resolution", () => {
  it("creates a discoverable unix socket path under the Codex browser-use directory", () => {
    const pipePath = resolveDefaultBrowserUsePipePath("darwin");

    expect(dirname(pipePath)).toBe(`${tmpdir()}/codex-browser-use`);
    expect(basename(pipePath)).toMatch(/^chitauri-iab-\d+\.sock$/);
  });

  it("prefers an explicit Chitauri pipe path from the environment", () => {
    expect(
      resolveConfiguredBrowserUsePipePath(
        {
          [CHITAURI_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/chitauri.sock",
        },
        "darwin",
      ),
    ).toBe("/tmp/codex-browser-use/chitauri.sock");
  });

  it("falls back to the default pipe path when the env override is blank", () => {
    expect(
      resolveConfiguredBrowserUsePipePath(
        {
          [CHITAURI_BROWSER_USE_PIPE_ENV]: "   ",
        },
        "darwin",
      ),
    ).toBe(resolveDefaultBrowserUsePipePath("darwin"));
  });
});
