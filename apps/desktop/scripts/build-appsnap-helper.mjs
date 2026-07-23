#!/usr/bin/env node
// FILE: build-appsnap-helper.mjs
// Purpose: Builds, fingerprints, combines, and signs TeaCode's native macOS AppSnap helper.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch as hostArch, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const desktopDirectory = resolve(dirname(scriptPath), "..");
const sourceDirectory = join(desktopDirectory, "native", "appsnap");
const defaultOutput = join(
  desktopDirectory,
  ".electron-runtime",
  "appsnap",
  "teacode-appsnap-helper",
);
const sources = [
  "AppSnapProtocol.swift",
  "Permissions.swift",
  "ModifierChordMonitor.swift",
  "WindowCapture.swift",
  "CaptureFeedback.swift",
  "ParentProcessMonitor.swift",
  "main.swift",
].map((name) => join(sourceDirectory, name));
const frameworks = [
  "AppKit",
  "CoreGraphics",
  "CoreImage",
  "CoreMedia",
  "CoreVideo",
  "ScreenCaptureKit",
];

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const mode = option("--mode", "development");
const requestedArch = option("--arch", hostArch() === "x64" ? "x64" : "arm64");
const outputPath = resolve(option("--output", defaultOutput));
if (platform() !== "darwin") process.exit(0);
if (!["development", "release"].includes(mode)) throw new Error(`Invalid helper mode: ${mode}`);
if (!["arm64", "x64", "universal"].includes(requestedArch)) {
  throw new Error(`Invalid helper architecture: ${requestedArch}`);
}
for (const source of sources) {
  if (!existsSync(source)) throw new Error(`Missing AppSnap source: ${source}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0)
    throw new Error(`${command} failed with status ${result.status ?? "unknown"}`);
}

const targets = requestedArch === "universal" ? ["arm64", "x64"] : [requestedArch];
const swiftFlags = mode === "release" ? ["-O", "-whole-module-optimization"] : ["-Onone", "-g"];
const fingerprint = createHash("sha256");
fingerprint.update("teacode-appsnap-helper-v1\0");
fingerprint.update(JSON.stringify({ mode, requestedArch, swiftFlags, frameworks }));
fingerprint.update(readFileSync(scriptPath));
for (const source of sources) {
  fingerprint.update(source);
  fingerprint.update(readFileSync(source));
}
const fingerprintPath = `${outputPath}.fingerprint`;
const expectedFingerprint = fingerprint.digest("hex");

function verifies(path) {
  if (!existsSync(path)) return false;
  const result = spawnSync("codesign", ["--verify", "--strict", path], { stdio: "ignore" });
  return result.status === 0;
}

if (
  existsSync(fingerprintPath) &&
  readFileSync(fingerprintPath, "utf8").trim() === expectedFingerprint &&
  verifies(outputPath)
) {
  console.log(`[appsnap-helper] Reusing ${outputPath}`);
  process.exit(0);
}

mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
const temporaryDirectory = mkdtempSync(join(tmpdir(), "teacode-appsnap-helper-"));
try {
  const thinBinaries = [];
  for (const targetArch of targets) {
    const swiftArch = targetArch === "x64" ? "x86_64" : "arm64";
    const thinPath = join(temporaryDirectory, `teacode-appsnap-helper-${targetArch}`);
    const frameworkArgs = frameworks.flatMap((framework) => ["-framework", framework]);
    run("xcrun", [
      "swiftc",
      "-target",
      `${swiftArch}-apple-macos12.3`,
      ...swiftFlags,
      ...frameworkArgs,
      ...sources,
      "-o",
      thinPath,
    ]);
    thinBinaries.push(thinPath);
  }

  const unsigned = join(temporaryDirectory, "teacode-appsnap-helper");
  if (thinBinaries.length === 1) renameSync(thinBinaries[0], unsigned);
  else run("xcrun", ["lipo", "-create", ...thinBinaries, "-output", unsigned]);
  chmodSync(unsigned, 0o755);
  run("codesign", ["--force", "--sign", "-", "--timestamp=none", unsigned]);
  run("codesign", ["--verify", "--strict", unsigned]);

  const staged = `${outputPath}.staged-${process.pid}`;
  rmSync(staged, { force: true });
  renameSync(unsigned, staged);
  renameSync(staged, outputPath);
  chmodSync(outputPath, 0o755);
  writeFileSync(fingerprintPath, `${expectedFingerprint}\n`, { mode: 0o600 });
  console.log(`[appsnap-helper] Built ${requestedArch} ${mode} helper at ${outputPath}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
