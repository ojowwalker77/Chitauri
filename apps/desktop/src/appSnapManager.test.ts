import * as ChildProcess from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  DesktopAppSnapManager,
  desktopAppSnapPlatform,
  isPathInsideDirectory,
  parseAppSnapHelperMessage,
} from "./appSnapManager";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type FakeChildProcess = ChildProcess.ChildProcessWithoutNullStreams & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
};

function createFakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  return child;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function pendingKey(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

function writePendingCapture(directory: string, id: string, capturedAt: string): void {
  const base = join(directory, `pending-${pendingKey(id)}`);
  writeFileSync(`${base}.png`, PNG_BYTES, { mode: 0o600 });
  writeFileSync(
    `${base}.json`,
    `${JSON.stringify({
      version: 1,
      id,
      capturedAt,
      name: `${id}.png`,
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      sourceAppName: null,
      sourceBundleIdentifier: null,
      sourceAppIconDataUrl: null,
      sourceWindowTitle: null,
    })}\n`,
    { mode: 0o600 },
  );
}

function createManager(captureDirectory: string, platform: NodeJS.Platform = "darwin") {
  return new DesktopAppSnapManager({
    platform,
    helperPath: process.execPath,
    captureDirectory,
    excludedBundleId: "dev.jow.TeaCode.dev",
    onState: vi.fn(),
    onCaptured: vi.fn(),
    onError: vi.fn(),
  });
}

describe("desktop AppSnap state", () => {
  it("returns typed unsupported state outside macOS", async () => {
    const manager = createManager("C:\\tmp\\appsnap", "win32");
    expect(desktopAppSnapPlatform("darwin")).toBe("macos");
    expect(desktopAppSnapPlatform("linux")).toBe("linux");
    expect(await manager.setEnabled(true)).toMatchObject({
      platform: "windows",
      supported: false,
      enabled: false,
      status: "unsupported",
      shortcut: null,
    });
  });

  it("reports a missing native helper without prompting for permissions", async () => {
    const manager = new DesktopAppSnapManager({
      platform: "darwin",
      helperPath: "/tmp/teacode-appsnap-helper-that-does-not-exist",
      captureDirectory: "/tmp/teacode-appsnap-test",
      excludedBundleId: "dev.jow.TeaCode.dev",
      onState: vi.fn(),
      onCaptured: vi.fn(),
      onError: vi.fn(),
    });
    expect(await manager.setEnabled(true)).toMatchObject({
      enabled: true,
      status: "error",
      message: "The AppSnap helper is missing from this TeaCode build.",
    });
  });
});

describe("AppSnap helper protocol and paths", () => {
  it("parses bounded typed messages and rejects malformed output", () => {
    expect(
      parseAppSnapHelperMessage(
        JSON.stringify({
          type: "captured",
          id: "capture-1",
          path: "/tmp/appsnap/capture-1.png",
          name: "capture.png",
          sourceAppName: "Safari",
        }),
      ),
    ).toMatchObject({ type: "captured", id: "capture-1", sourceAppName: "Safari" });
    expect(parseAppSnapHelperMessage("not-json")).toBeNull();
    expect(parseAppSnapHelperMessage(JSON.stringify({ type: "captured", path: "/tmp/x" }))).toBe(
      null,
    );
    expect(parseAppSnapHelperMessage("x".repeat(64 * 1024 + 1))).toBeNull();
  });

  it("accepts only descendants of the private capture directory", () => {
    expect(isPathInsideDirectory("/tmp/appsnap", "/tmp/appsnap/capture.png")).toBe(true);
    expect(isPathInsideDirectory("/tmp/appsnap", "/tmp/appsnap-escape/capture.png")).toBe(false);
    expect(isPathInsideDirectory("/tmp/appsnap", "/tmp/appsnap")).toBe(false);
  });

  it("serializes permission commands until helper stdout closes", async () => {
    const checkChild = createFakeChildProcess();
    const requestChild = createFakeChildProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(checkChild)
      .mockReturnValueOnce(requestChild) as unknown as typeof ChildProcess.spawn;
    const manager = new DesktopAppSnapManager({
      platform: "darwin",
      helperPath: process.execPath,
      captureDirectory: "/tmp/teacode-appsnap-permission-test",
      excludedBundleId: "dev.jow.TeaCode.dev",
      spawn,
      onState: vi.fn(),
      onCaptured: vi.fn(),
      onError: vi.fn(),
    });

    const check = manager.refreshState();
    const request = manager.requestPermissions();
    await flushPromises();
    expect(spawn).toHaveBeenCalledTimes(1);
    checkChild.stdout.end(
      `${JSON.stringify({
        type: "permissions",
        inputMonitoring: "denied",
        screenRecording: "denied",
      })}\n`,
    );
    checkChild.stderr.end();
    checkChild.emit("close", 0, null);
    await flushPromises();
    expect(spawn).toHaveBeenCalledTimes(2);

    requestChild.stdout.end(
      `${JSON.stringify({
        type: "permissions",
        inputMonitoring: "granted",
        screenRecording: "granted",
      })}\n`,
    );
    requestChild.stderr.end();
    requestChild.emit("close", 0, null);
    await Promise.all([check, request]);
    expect(manager.getState()).toMatchObject({
      inputMonitoringPermission: "granted",
      screenRecordingPermission: "granted",
    });
    manager.dispose();
  });

  it("restarts the listener after permissions are restored", async () => {
    const directory = mkdtempSync(join(tmpdir(), "teacode-appsnap-listener-"));
    const checkChild = createFakeChildProcess();
    const watchChild = createFakeChildProcess();
    const requestChild = createFakeChildProcess();
    const restartedWatchChild = createFakeChildProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(checkChild)
      .mockReturnValueOnce(watchChild)
      .mockReturnValueOnce(requestChild)
      .mockReturnValueOnce(restartedWatchChild) as unknown as typeof ChildProcess.spawn;
    const onError = vi.fn();
    const manager = new DesktopAppSnapManager({
      platform: "darwin",
      helperPath: process.execPath,
      captureDirectory: directory,
      excludedBundleId: "dev.jow.TeaCode.dev",
      spawn,
      onState: vi.fn(),
      onCaptured: vi.fn(),
      onError,
    });
    try {
      const enable = manager.setEnabled(true);
      await flushPromises();
      checkChild.stdout.end(
        `${JSON.stringify({
          type: "permissions",
          inputMonitoring: "granted",
          screenRecording: "granted",
        })}\n`,
      );
      checkChild.stderr.end();
      checkChild.emit("close", 0, null);
      await enable;
      watchChild.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);
      expect(manager.getState().status).toBe("ready");

      watchChild.stdout.write(
        `${JSON.stringify({
          type: "error",
          code: "capture_in_progress",
          message: "An AppSnap is already being captured.",
        })}\n`,
      );
      await flushPromises();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "capture_in_progress" }),
        false,
      );

      watchChild.stdout.write(
        `${JSON.stringify({
          type: "error",
          code: "screen-recording-required",
          message: "Screen Recording permission is required.",
        })}\n`,
      );
      await flushPromises();
      expect(manager.getState().status).toBe("permission-required");
      expect(watchChild.kill).toHaveBeenCalledWith("SIGTERM");

      const request = manager.requestPermissions();
      await flushPromises();
      requestChild.stdout.end(
        `${JSON.stringify({
          type: "permissions",
          inputMonitoring: "granted",
          screenRecording: "granted",
        })}\n`,
      );
      requestChild.stderr.end();
      requestChild.emit("close", 0, null);
      await request;
      restartedWatchChild.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);
      expect(spawn).toHaveBeenCalledTimes(4);
      expect(manager.getState().status).toBe("ready");
    } finally {
      manager.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("surfaces an unexpected listener exit as a restartable error", async () => {
    const directory = mkdtempSync(join(tmpdir(), "teacode-appsnap-exit-"));
    const checkChild = createFakeChildProcess();
    const watchChild = createFakeChildProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(checkChild)
      .mockReturnValueOnce(watchChild) as unknown as typeof ChildProcess.spawn;
    const onError = vi.fn();
    const manager = new DesktopAppSnapManager({
      platform: "darwin",
      helperPath: process.execPath,
      captureDirectory: directory,
      excludedBundleId: "dev.jow.TeaCode.dev",
      spawn,
      onState: vi.fn(),
      onCaptured: vi.fn(),
      onError,
    });
    try {
      const enable = manager.setEnabled(true);
      await flushPromises();
      checkChild.stdout.end(
        `${JSON.stringify({
          type: "permissions",
          inputMonitoring: "granted",
          screenRecording: "granted",
        })}\n`,
      );
      checkChild.stderr.end();
      checkChild.emit("close", 0, null);
      await enable;
      watchChild.emit("exit", 1, null);
      expect(manager.getState()).toMatchObject({
        status: "error",
        message: "The AppSnap listener stopped unexpectedly (exit 1).",
      });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "helper-stopped" }),
        false,
      );
    } finally {
      manager.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("AppSnap chord configuration", () => {
  it("defaults to the option chord and reports it as the shortcut", () => {
    const manager = createManager("/tmp/teacode-appsnap-chord-default");
    expect(manager.getState().shortcut).toBe("option");
  });

  it("restarts a running watcher with the new chord", async () => {
    const directory = mkdtempSync(join(tmpdir(), "teacode-appsnap-chord-"));
    const checkChild = createFakeChildProcess();
    const watchChild = createFakeChildProcess();
    const restartedWatchChild = createFakeChildProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(checkChild)
      .mockReturnValueOnce(watchChild)
      .mockReturnValueOnce(restartedWatchChild) as unknown as typeof ChildProcess.spawn;
    const manager = new DesktopAppSnapManager({
      platform: "darwin",
      helperPath: process.execPath,
      captureDirectory: directory,
      excludedBundleId: "dev.jow.TeaCode.dev",
      spawn,
      onState: vi.fn(),
      onCaptured: vi.fn(),
      onError: vi.fn(),
    });
    try {
      const enable = manager.setEnabled(true);
      await flushPromises();
      checkChild.stdout.end(
        `${JSON.stringify({
          type: "permissions",
          inputMonitoring: "granted",
          screenRecording: "granted",
        })}\n`,
      );
      checkChild.stderr.end();
      checkChild.emit("close", 0, null);
      await enable;
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        process.execPath,
        expect.arrayContaining(["--chord", "option"]),
        expect.anything(),
      );

      await manager.setChord("shift");
      expect(watchChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(manager.getState().shortcut).toBe("shift");
      expect(spawn).toHaveBeenNthCalledWith(
        3,
        process.execPath,
        expect.arrayContaining(["--chord", "shift"]),
        expect.anything(),
      );
    } finally {
      manager.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not restart or respawn when the chord is unchanged", async () => {
    const spawn = vi.fn() as unknown as typeof ChildProcess.spawn;
    const manager = new DesktopAppSnapManager({
      platform: "darwin",
      helperPath: process.execPath,
      captureDirectory: "/tmp/teacode-appsnap-chord-noop",
      excludedBundleId: "dev.jow.TeaCode.dev",
      spawn,
      onState: vi.fn(),
      onCaptured: vi.fn(),
      onError: vi.fn(),
    });
    await manager.setChord("option");
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("durable AppSnap pending captures", () => {
  it("restores, caps, and acknowledges private pending pairs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "teacode-appsnap-pending-"));
    try {
      for (let index = 0; index < PROVIDER_SEND_TURN_MAX_ATTACHMENTS + 2; index += 1) {
        writePendingCapture(
          directory,
          `capture-${index}`,
          new Date(Date.UTC(2026, 6, 17, 0, 0, index)).toISOString(),
        );
      }
      const onError = vi.fn();
      const manager = new DesktopAppSnapManager({
        platform: "darwin",
        helperPath: process.execPath,
        captureDirectory: directory,
        excludedBundleId: "dev.jow.TeaCode.dev",
        onState: vi.fn(),
        onCaptured: vi.fn(),
        onError,
      });
      const pending = await manager.listPendingCaptures();
      expect(pending).toHaveLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS);
      expect(pending.map((capture) => capture.id)).toEqual(
        Array.from(
          { length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS },
          (_, index) => `capture-${index + 2}`,
        ),
      );
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "pending-capture-overflow" }),
        false,
      );

      const acknowledged = pending[0]!;
      const base = join(directory, `pending-${pendingKey(acknowledged.id)}`);
      await manager.acknowledgeCapture(acknowledged.id);
      expect(existsSync(`${base}.png`)).toBe(false);
      expect(existsSync(`${base}.json`)).toBe(false);
      expect(await manager.listPendingCaptures()).toHaveLength(
        PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1,
      );
      manager.dispose();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects symlinked pending images", async () => {
    const directory = mkdtempSync(join(tmpdir(), "teacode-appsnap-symlink-"));
    try {
      const id = "capture-symlink";
      const base = join(directory, `pending-${pendingKey(id)}`);
      const target = join(directory, "target.png");
      writeFileSync(target, PNG_BYTES, { mode: 0o600 });
      symlinkSync(target, `${base}.png`);
      writeFileSync(
        `${base}.json`,
        `${JSON.stringify({
          version: 1,
          id,
          capturedAt: "2026-07-17T00:00:00.000Z",
          name: "capture.png",
          mimeType: "image/png",
          sizeBytes: PNG_BYTES.byteLength,
          sourceAppName: null,
          sourceBundleIdentifier: null,
          sourceAppIconDataUrl: null,
          sourceWindowTitle: null,
        })}\n`,
        { mode: 0o600 },
      );
      const manager = createManager(directory);
      expect(await manager.listPendingCaptures()).toEqual([]);
      expect(existsSync(target)).toBe(true);
      manager.dispose();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
