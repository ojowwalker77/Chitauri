// FILE: appSnapManager.ts
// Purpose: Owns TeaCode's macOS AppSnap helper, permission state, and durable pending queue.
// Layer: Electron main process

import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import * as Readline from "node:readline";
import type { Readable } from "node:stream";

import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type DesktopAppSnapCapture,
  type DesktopAppSnapErrorEvent,
  type DesktopAppSnapPermission,
  type DesktopAppSnapPlatform,
  type DesktopAppSnapState,
} from "@t3tools/contracts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PENDING_VERSION = 1;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_STDERR_CHARS = 4_096;
const PENDING_METADATA_PATTERN = /^pending-([a-f0-9]{64})\.json$/;
const PENDING_IMAGE_PATTERN = /^pending-([a-f0-9]{64})\.png$/;
const HELPER_IMAGE_PATTERN =
  /^appsnap-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.png$/;

type HelperProcess = ChildProcess.ChildProcessByStdio<null, Readable, Readable>;

type AppSnapHelperEvent =
  | {
      type: "permissions";
      inputMonitoring: "granted" | "denied";
      screenRecording: "granted" | "denied";
    }
  | { type: "ready" }
  | { type: "triggered"; id: string; capturedAt?: string }
  | {
      type: "captured";
      id: string;
      capturedAt?: string;
      path: string;
      name: string;
      sourceAppName?: string | null;
      sourceBundleIdentifier?: string | null;
      sourceAppIconDataUrl?: string | null;
      sourceWindowTitle?: string | null;
    }
  | { type: "error"; id?: string; code: string; message: string; capturedAt?: string };

interface StoredPendingCapture {
  version: 1;
  id: string;
  capturedAt: string;
  name: string;
  mimeType: "image/png";
  sizeBytes: number;
  sourceAppName: string | null;
  sourceBundleIdentifier: string | null;
  sourceAppIconDataUrl: string | null;
  sourceWindowTitle: string | null;
}

interface PendingCaptureRecord {
  capture: DesktopAppSnapCapture;
  imagePath: string;
  metadataPath: string;
}

export interface DesktopAppSnapManagerOptions {
  platform: NodeJS.Platform;
  helperPath: string;
  captureDirectory: string;
  excludedBundleId: string;
  onState: (state: DesktopAppSnapState) => void;
  onCaptured: (capture: DesktopAppSnapCapture) => void;
  onError: (error: DesktopAppSnapErrorEvent, focusApp: boolean) => void;
  now?: () => Date;
  spawn?: typeof ChildProcess.spawn;
}

function boundedText(value: unknown, maximum = 512): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, maximum) : null;
}

function normalizedDate(value: unknown, fallback: Date): string {
  if (typeof value !== "string") return fallback.toISOString();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback.toISOString();
}

function normalizedIcon(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256_000) return null;
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
}

function pendingKey(id: string): string {
  return Crypto.createHash("sha256").update(id).digest("hex");
}

function pendingPaths(
  directory: string,
  id: string,
): Pick<PendingCaptureRecord, "imagePath" | "metadataPath"> {
  const base = Path.join(directory, `pending-${pendingKey(id)}`);
  return { imagePath: `${base}.png`, metadataPath: `${base}.json` };
}

function storedPendingCapture(capture: DesktopAppSnapCapture): StoredPendingCapture {
  return {
    version: PENDING_VERSION,
    id: capture.id,
    capturedAt: capture.capturedAt,
    name: capture.name,
    mimeType: "image/png",
    sizeBytes: capture.sizeBytes,
    sourceAppName: capture.sourceAppName,
    sourceBundleIdentifier: capture.sourceBundleIdentifier,
    sourceAppIconDataUrl: capture.sourceAppIconDataUrl,
    sourceWindowTitle: capture.sourceWindowTitle,
  };
}

function parseStoredPendingCapture(value: unknown): StoredPendingCapture | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = boundedText(candidate.id, 128);
  const capturedAt = boundedText(candidate.capturedAt, 128);
  const name = boundedText(candidate.name, 240);
  const sizeBytes = candidate.sizeBytes;
  if (
    candidate.version !== PENDING_VERSION ||
    !id ||
    !capturedAt ||
    !Number.isFinite(Date.parse(capturedAt)) ||
    !name ||
    candidate.mimeType !== "image/png" ||
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
  ) {
    return null;
  }
  return {
    version: PENDING_VERSION,
    id,
    capturedAt: new Date(capturedAt).toISOString(),
    name,
    mimeType: "image/png",
    sizeBytes,
    sourceAppName: boundedText(candidate.sourceAppName),
    sourceBundleIdentifier: boundedText(candidate.sourceBundleIdentifier),
    sourceAppIconDataUrl: normalizedIcon(candidate.sourceAppIconDataUrl),
    sourceWindowTitle: boundedText(candidate.sourceWindowTitle),
  };
}

async function readRegularFile(
  filePath: string,
  maximumBytes: number,
  expectedBytes?: number,
): Promise<Buffer> {
  const file = await FS.promises.open(
    filePath,
    FS.constants.O_RDONLY | FS.constants.O_NOFOLLOW | FS.constants.O_NONBLOCK,
  );
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Expected a regular file.");
    if (stats.size <= 0 || stats.size > maximumBytes) throw new Error("Invalid file size.");
    if (expectedBytes !== undefined && stats.size !== expectedBytes) {
      throw new Error("The file size does not match its metadata.");
    }
    const bytes = await file.readFile();
    if (bytes.byteLength !== stats.size) throw new Error("The file changed while being read.");
    return bytes;
  } finally {
    await file.close();
  }
}

async function readPng(filePath: string, expectedBytes?: number): Promise<Buffer> {
  const bytes = await readRegularFile(filePath, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, expectedBytes);
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Expected a PNG image.");
  }
  return bytes;
}

async function writePrivateFile(filePath: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Crypto.randomUUID()}`;
  try {
    await FS.promises.writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    await FS.promises.rename(temporaryPath, filePath);
    await FS.promises.chmod(filePath, 0o600).catch(() => undefined);
  } finally {
    await FS.promises.unlink(temporaryPath).catch(() => undefined);
  }
}

export function desktopAppSnapPlatform(platform: NodeJS.Platform): DesktopAppSnapPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "other";
}

export function isPathInsideDirectory(directory: string, candidate: string): boolean {
  const relative = Path.relative(Path.resolve(directory), Path.resolve(candidate));
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${Path.sep}`);
}

function isPermission(value: unknown): value is "granted" | "denied" {
  return value === "granted" || value === "denied";
}

export function parseAppSnapHelperMessage(line: string): AppSnapHelperEvent | null {
  if (line.length === 0 || line.length > 64 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (
    value.type === "permissions" &&
    isPermission(value.inputMonitoring) &&
    isPermission(value.screenRecording)
  ) {
    return {
      type: "permissions",
      inputMonitoring: value.inputMonitoring,
      screenRecording: value.screenRecording,
    };
  }
  if (value.type === "ready") return { type: "ready" };
  if (value.type === "triggered" && boundedText(value.id, 128)) {
    return {
      type: "triggered",
      id: boundedText(value.id, 128)!,
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
    };
  }
  if (
    value.type === "captured" &&
    boundedText(value.id, 128) &&
    boundedText(value.path, 4096) &&
    boundedText(value.name, 240)
  ) {
    return {
      type: "captured",
      id: boundedText(value.id, 128)!,
      path: boundedText(value.path, 4096)!,
      name: boundedText(value.name, 240)!,
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
      ...(typeof value.sourceAppName === "string" || value.sourceAppName === null
        ? { sourceAppName: value.sourceAppName }
        : {}),
      ...(typeof value.sourceBundleIdentifier === "string" || value.sourceBundleIdentifier === null
        ? { sourceBundleIdentifier: value.sourceBundleIdentifier }
        : {}),
      ...(typeof value.sourceAppIconDataUrl === "string" || value.sourceAppIconDataUrl === null
        ? { sourceAppIconDataUrl: value.sourceAppIconDataUrl }
        : {}),
      ...(typeof value.sourceWindowTitle === "string" || value.sourceWindowTitle === null
        ? { sourceWindowTitle: value.sourceWindowTitle }
        : {}),
    };
  }
  if (value.type === "error" && boundedText(value.code, 128) && boundedText(value.message, 1_000)) {
    return {
      type: "error",
      code: boundedText(value.code, 128)!,
      message: boundedText(value.message, 1_000)!,
      ...(boundedText(value.id, 128) ? { id: boundedText(value.id, 128)! } : {}),
      ...(typeof value.capturedAt === "string" ? { capturedAt: value.capturedAt } : {}),
    };
  }
  return null;
}

function permissionMessage(
  inputMonitoring: DesktopAppSnapPermission,
  screenRecording: DesktopAppSnapPermission,
): string {
  const missing: string[] = [];
  if (inputMonitoring !== "granted") missing.push("Input Monitoring");
  if (screenRecording !== "granted") missing.push("Screen Recording");
  return `Allow ${missing.join(" and ")} in macOS System Settings, then recheck permissions.`;
}

export class DesktopAppSnapManager {
  readonly #options: Omit<DesktopAppSnapManagerOptions, "now" | "spawn"> & {
    now: () => Date;
    spawn: typeof ChildProcess.spawn;
  };
  readonly #platform: DesktopAppSnapPlatform;
  #enabled = false;
  #status: DesktopAppSnapState["status"];
  #message: string | null;
  #inputPermission: DesktopAppSnapPermission = "unknown";
  #screenPermission: DesktopAppSnapPermission = "unknown";
  #watchProcess: HelperProcess | null = null;
  #watchLines: Readline.Interface | null = null;
  #permissionProcess: HelperProcess | null = null;
  #permissionQueue: Promise<void> = Promise.resolve();
  #captureQueue: Promise<void> = Promise.resolve();
  #reconcilePromise: Promise<void> | null = null;
  #reconcileAgain = false;
  #pendingLoad: Promise<void> | null = null;
  #pending: PendingCaptureRecord[] = [];
  #disposed = false;
  #intentionalStop = false;

  constructor(options: DesktopAppSnapManagerOptions) {
    this.#options = {
      ...options,
      now: options.now ?? (() => new Date()),
      spawn: options.spawn ?? ChildProcess.spawn,
    };
    this.#platform = desktopAppSnapPlatform(options.platform);
    this.#status = this.#platform === "macos" ? "disabled" : "unsupported";
    this.#message =
      this.#platform === "macos" ? null : "AppSnap is available only in TeaCode for macOS.";
  }

  getState(): DesktopAppSnapState {
    return {
      platform: this.#platform,
      supported: this.#platform === "macos",
      enabled: this.#enabled,
      status: this.#status,
      shortcut: this.#platform === "macos" ? "both-option-keys" : null,
      inputMonitoringPermission: this.#inputPermission,
      screenRecordingPermission: this.#screenPermission,
      message: this.#message,
    };
  }

  async refreshState(): Promise<DesktopAppSnapState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    if (await this.#runPermissionCommand("--check-permissions")) await this.#reconcile();
    return this.getState();
  }

  async setEnabled(enabled: boolean): Promise<DesktopAppSnapState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    this.#enabled = enabled;
    if (!enabled) {
      this.#stopWatcher();
      this.#setState("disabled", null);
      return this.getState();
    }
    if (await this.#runPermissionCommand("--check-permissions")) await this.#reconcile();
    return this.getState();
  }

  async requestPermissions(): Promise<DesktopAppSnapState> {
    if (this.#platform !== "macos" || this.#disposed) return this.getState();
    if (await this.#runPermissionCommand("--request-permissions")) await this.#reconcile();
    return this.getState();
  }

  async listPendingCaptures(): Promise<DesktopAppSnapCapture[]> {
    await this.#ensurePendingLoaded();
    return this.#pending.map(({ capture }) => ({
      ...capture,
      bytes: new Uint8Array(capture.bytes),
    }));
  }

  async acknowledgeCapture(captureId: string): Promise<void> {
    const normalizedId = boundedText(captureId, 128);
    if (!normalizedId) return;
    await this.#ensurePendingLoaded();
    const acknowledged = this.#pending.filter((record) => record.capture.id === normalizedId);
    for (const record of acknowledged) await this.#deletePendingRecord(record);
    this.#pending = this.#pending.filter((record) => record.capture.id !== normalizedId);
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopWatcher();
    this.#permissionProcess?.kill("SIGTERM");
    this.#permissionProcess = null;
    this.#pending = [];
  }

  async #ensurePendingLoaded(): Promise<void> {
    this.#pendingLoad ??= this.#restorePending();
    try {
      await this.#pendingLoad;
    } catch (error) {
      this.#pendingLoad = null;
      throw error;
    }
  }

  async #restorePending(): Promise<void> {
    await FS.promises.mkdir(this.#options.captureDirectory, { recursive: true, mode: 0o700 });
    await FS.promises.chmod(this.#options.captureDirectory, 0o700).catch(() => undefined);
    const entries = await FS.promises.readdir(this.#options.captureDirectory);
    const records: PendingCaptureRecord[] = [];
    const metadataKeys = new Set(
      entries.flatMap((entry) => PENDING_METADATA_PATTERN.exec(entry)?.[1] ?? []),
    );

    for (const entry of entries) {
      const orphanImageKey = PENDING_IMAGE_PATTERN.exec(entry)?.[1];
      if (orphanImageKey && !metadataKeys.has(orphanImageKey)) {
        await FS.promises
          .unlink(Path.join(this.#options.captureDirectory, entry))
          .catch(() => undefined);
      }
    }

    for (const entry of entries) {
      const key = PENDING_METADATA_PATTERN.exec(entry)?.[1];
      if (!key) continue;
      const metadataPath = Path.join(this.#options.captureDirectory, entry);
      const imagePath = Path.join(this.#options.captureDirectory, `pending-${key}.png`);
      try {
        const metadataBytes = await readRegularFile(metadataPath, MAX_METADATA_BYTES);
        const stored = parseStoredPendingCapture(JSON.parse(metadataBytes.toString("utf8")));
        if (!stored || pendingKey(stored.id) !== key) throw new Error("Invalid pending metadata.");
        const bytes = await readPng(imagePath, stored.sizeBytes);
        records.push({
          capture: { ...stored, bytes: new Uint8Array(bytes) },
          imagePath,
          metadataPath,
        });
      } catch (error) {
        console.warn(`[appsnap] Removing invalid pending record ${entry}`, error);
        await FS.promises.unlink(metadataPath).catch(() => undefined);
        await FS.promises.unlink(imagePath).catch(() => undefined);
      }
    }

    for (const entry of entries) {
      const captureId = HELPER_IMAGE_PATTERN.exec(entry)?.[1];
      if (!captureId) continue;
      const helperPath = Path.join(this.#options.captureDirectory, entry);
      if (records.some((record) => record.capture.id === captureId)) {
        await FS.promises.unlink(helperPath).catch(() => undefined);
        continue;
      }
      try {
        const bytes = await readPng(helperPath);
        const capture: DesktopAppSnapCapture = {
          id: captureId,
          capturedAt: this.#options.now().toISOString(),
          name: entry,
          mimeType: "image/png",
          sizeBytes: bytes.byteLength,
          bytes: new Uint8Array(bytes),
          sourceAppName: null,
          sourceBundleIdentifier: null,
          sourceAppIconDataUrl: null,
          sourceWindowTitle: null,
        };
        records.push(await this.#persistPending(capture));
        await FS.promises.unlink(helperPath).catch(() => undefined);
      } catch (error) {
        console.warn(`[appsnap] Could not recover helper output ${entry}`, error);
      }
    }

    records.sort((left, right) => left.capture.capturedAt.localeCompare(right.capture.capturedAt));
    const overflow = records.slice(
      0,
      Math.max(0, records.length - PROVIDER_SEND_TURN_MAX_ATTACHMENTS),
    );
    for (const record of overflow) await this.#deletePendingRecord(record).catch(() => undefined);
    this.#pending = records.slice(-PROVIDER_SEND_TURN_MAX_ATTACHMENTS);
    if (overflow.length > 0) {
      this.#emitError(
        "pending-capture-overflow",
        `TeaCode retained the latest ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} AppSnaps and discarded ${overflow.length} older pending capture${overflow.length === 1 ? "" : "s"}.`,
        overflow.at(-1)?.capture.capturedAt,
        false,
      );
    }
  }

  async #persistPending(capture: DesktopAppSnapCapture): Promise<PendingCaptureRecord> {
    const paths = pendingPaths(this.#options.captureDirectory, capture.id);
    await writePrivateFile(paths.imagePath, capture.bytes);
    try {
      const metadata = Buffer.from(`${JSON.stringify(storedPendingCapture(capture))}\n`, "utf8");
      if (metadata.byteLength > MAX_METADATA_BYTES) throw new Error("Metadata is too large.");
      await writePrivateFile(paths.metadataPath, metadata);
      return { capture, ...paths };
    } catch (error) {
      await FS.promises.unlink(paths.imagePath).catch(() => undefined);
      throw error;
    }
  }

  async #deletePendingRecord(record: PendingCaptureRecord): Promise<void> {
    await Promise.all(
      [record.imagePath, record.metadataPath].map((path) =>
        FS.promises.unlink(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        }),
      ),
    );
  }

  #setState(status: DesktopAppSnapState["status"], message: string | null): void {
    const changed = this.#status !== status || this.#message !== message;
    this.#status = status;
    this.#message = message;
    if (changed) this.#options.onState(this.getState());
  }

  async #reconcile(): Promise<void> {
    this.#reconcileAgain = true;
    if (this.#reconcilePromise) return this.#reconcilePromise;
    const run = (async () => {
      while (this.#reconcileAgain) {
        this.#reconcileAgain = false;
        await this.#reconcileOnce();
      }
    })();
    this.#reconcilePromise = run.finally(() => {
      this.#reconcilePromise = null;
    });
    return this.#reconcilePromise;
  }

  async #reconcileOnce(): Promise<void> {
    if (this.#disposed || this.#platform !== "macos") return;
    if (!this.#enabled) {
      this.#stopWatcher();
      this.#setState("disabled", null);
      return;
    }
    if (this.#inputPermission !== "granted" || this.#screenPermission !== "granted") {
      this.#stopWatcher();
      this.#setState(
        "permission-required",
        permissionMessage(this.#inputPermission, this.#screenPermission),
      );
      return;
    }
    if (!FS.existsSync(this.#options.helperPath)) {
      this.#stopWatcher();
      this.#setState("error", "The AppSnap helper is missing from this TeaCode build.");
      return;
    }
    if (this.#watchProcess) return;
    await FS.promises.mkdir(this.#options.captureDirectory, { recursive: true, mode: 0o700 });
    await FS.promises.chmod(this.#options.captureDirectory, 0o700).catch(() => undefined);
    if (!this.#disposed && this.#enabled && !this.#watchProcess) this.#startWatcher();
  }

  #startWatcher(): void {
    this.#intentionalStop = false;
    this.#setState("starting", null);
    const child = this.#options.spawn(
      this.#options.helperPath,
      [
        "--watch",
        "--output-dir",
        this.#options.captureDirectory,
        "--excluded-bundle-id",
        this.#options.excludedBundleId,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.#watchProcess = child;
    this.#watchLines = this.#wireOutput(child, (event) => this.#handleHelperEvent(child, event));
    child.once("error", (error) => this.#handleUnexpectedStop(child, error.message));
    child.once("exit", (code, signal) => {
      this.#handleUnexpectedStop(child, signal ?? `exit ${code ?? "unknown"}`);
    });
  }

  #handleUnexpectedStop(child: HelperProcess, reason: string): void {
    if (this.#watchProcess !== child) return;
    this.#watchProcess = null;
    this.#watchLines?.close();
    this.#watchLines = null;
    if (this.#disposed || this.#intentionalStop || !this.#enabled) return;
    const message = `The AppSnap listener stopped unexpectedly (${reason}).`;
    this.#setState("error", message);
    this.#emitError("helper-stopped", message, undefined, false);
  }

  #stopWatcher(): void {
    const child = this.#watchProcess;
    this.#watchProcess = null;
    this.#watchLines?.close();
    this.#watchLines = null;
    if (!child) return;
    this.#intentionalStop = true;
    child.kill("SIGTERM");
  }

  #wireOutput(
    child: HelperProcess,
    onEvent: (event: AppSnapHelperEvent) => void,
  ): Readline.Interface {
    const lines = Readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const event = parseAppSnapHelperMessage(line);
      if (event) onEvent(event);
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(0, MAX_STDERR_CHARS);
    });
    child.once("close", (code) => {
      if (code !== 0 && stderr.trim()) console.warn(`[appsnap-helper] ${stderr.trim()}`);
    });
    return lines;
  }

  async #runPermissionCommand(
    command: "--check-permissions" | "--request-permissions",
  ): Promise<boolean> {
    const result = this.#permissionQueue.then(() => this.#executePermissionCommand(command));
    this.#permissionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #executePermissionCommand(
    command: "--check-permissions" | "--request-permissions",
  ): Promise<boolean> {
    if (this.#disposed || this.#platform !== "macos") return false;
    if (!FS.existsSync(this.#options.helperPath)) {
      this.#setState("error", "The AppSnap helper is missing from this TeaCode build.");
      return false;
    }
    return new Promise((resolve) => {
      let child: HelperProcess;
      try {
        child = this.#options.spawn(this.#options.helperPath, [command], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        this.#setState("error", `Could not inspect AppSnap permissions: ${String(error)}`);
        resolve(false);
        return;
      }
      this.#permissionProcess = child;
      let received = false;
      let helperError: string | null = null;
      this.#wireOutput(child, (event) => {
        if (event.type === "permissions") {
          received = true;
          this.#inputPermission = event.inputMonitoring;
          this.#screenPermission = event.screenRecording;
          this.#options.onState(this.getState());
        } else if (event.type === "error") {
          helperError = event.message;
        }
      });
      child.once("error", (error) => {
        if (this.#permissionProcess === child) this.#permissionProcess = null;
        this.#setState("error", `Could not inspect AppSnap permissions: ${error.message}`);
        resolve(false);
      });
      child.once("close", () => {
        if (this.#permissionProcess === child) this.#permissionProcess = null;
        if (!received && !this.#disposed) {
          this.#setState("error", helperError ?? "The AppSnap helper did not report permissions.");
        }
        resolve(received);
      });
    });
  }

  #handleHelperEvent(child: HelperProcess, event: AppSnapHelperEvent): void {
    if (this.#disposed || this.#watchProcess !== child) return;
    if (event.type === "ready") {
      this.#inputPermission = "granted";
      this.#setState("ready", null);
      return;
    }
    if (event.type === "permissions") {
      this.#inputPermission = event.inputMonitoring;
      this.#screenPermission = event.screenRecording;
      this.#options.onState(this.getState());
      return;
    }
    if (event.type === "triggered") return;
    if (event.type === "captured") {
      this.#captureQueue = this.#captureQueue
        .then(() => this.#consumeCapture(event))
        .catch((error) =>
          this.#emitError("capture-read-failed", String(error), event.capturedAt, true),
        );
      return;
    }
    if (event.code === "event_tap_disabled" || event.code === "event-tap-disabled") {
      console.warn(`[appsnap] ${event.message}`);
      return;
    }
    const inputPermissionRequired = event.code === "input-monitoring-required";
    const screenPermissionRequired = event.code === "screen-recording-required";
    if (inputPermissionRequired) this.#inputPermission = "denied";
    if (screenPermissionRequired) this.#screenPermission = "denied";
    if (
      inputPermissionRequired ||
      screenPermissionRequired ||
      event.code.includes("permission") ||
      event.code.includes("monitoring")
    ) {
      this.#stopWatcher();
      this.#setState(
        "permission-required",
        permissionMessage(this.#inputPermission, this.#screenPermission),
      );
    }
    const benign = event.code === "capture_in_progress" || event.code === "capture-in-progress";
    this.#emitError(event.code, event.message, event.capturedAt, !benign);
  }

  async #consumeCapture(event: Extract<AppSnapHelperEvent, { type: "captured" }>): Promise<void> {
    const helperPath = Path.resolve(event.path);
    if (!isPathInsideDirectory(this.#options.captureDirectory, helperPath)) {
      throw new Error("The helper returned a path outside its private capture directory.");
    }
    await this.#ensurePendingLoaded();
    const bytes = await readPng(helperPath);
    const now = this.#options.now();
    const capture: DesktopAppSnapCapture = {
      id: boundedText(event.id, 128) ?? Crypto.randomUUID(),
      capturedAt: normalizedDate(event.capturedAt, now),
      name: boundedText(event.name, 240) ?? `AppSnap-${now.toISOString()}.png`,
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      bytes: new Uint8Array(bytes),
      sourceAppName: boundedText(event.sourceAppName),
      sourceBundleIdentifier: boundedText(event.sourceBundleIdentifier),
      sourceAppIconDataUrl: normalizedIcon(event.sourceAppIconDataUrl),
      sourceWindowTitle: boundedText(event.sourceWindowTitle),
    };
    const record = await this.#persistPending(capture);
    await FS.promises.unlink(helperPath).catch(() => undefined);
    const next = [...this.#pending.filter((item) => item.capture.id !== capture.id), record];
    const discarded = next.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS ? next[0] : null;
    this.#pending = next.slice(-PROVIDER_SEND_TURN_MAX_ATTACHMENTS);
    if (discarded) {
      await this.#deletePendingRecord(discarded).catch(() => undefined);
      this.#emitError(
        "pending-capture-overflow",
        `TeaCode retained the latest ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} AppSnaps and discarded the oldest pending capture.`,
        discarded.capture.capturedAt,
        false,
      );
    }
    this.#options.onCaptured(capture);
  }

  #emitError(
    code: string,
    message: string,
    capturedAt: string | undefined,
    focusApp: boolean,
  ): void {
    this.#options.onError(
      {
        code: boundedText(code, 128) ?? "capture-failed",
        message: boundedText(message, 1_000) ?? "AppSnap capture failed.",
        capturedAt: normalizedDate(capturedAt, this.#options.now()),
      },
      focusApp,
    );
  }
}
