#!/usr/bin/env node
// FILE: release-preflight.ts
// Purpose: Prove a TeaCode tag already matches committed source identity before release builds.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { releasePackageFiles } from "./update-release-package-versions.ts";

const CANONICAL_TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)$/;

export function parseReleaseTag(tag: string): string {
  const match = CANONICAL_TAG_PATTERN.exec(tag.trim());
  if (!match?.[1]) {
    throw new Error(`Release tag must be canonical SemVer (vX.Y.Z): ${tag}`);
  }
  return match[1];
}

export function validateReleaseSource(rootDir: string, tag: string): string[] {
  const version = parseReleaseTag(tag);
  const errors: string[] = [];

  for (const relativePath of releasePackageFiles) {
    const packageJson = JSON.parse(readFileSync(resolve(rootDir, relativePath), "utf8")) as {
      version?: string;
    };
    if (packageJson.version !== version) {
      errors.push(`${relativePath} is ${packageJson.version ?? "missing"}; expected ${version}`);
    }
  }

  const desktopPackage = JSON.parse(
    readFileSync(resolve(rootDir, "apps/desktop/package.json"), "utf8"),
  ) as { productName?: string };
  if (desktopPackage.productName !== "TeaCode") {
    errors.push(`apps/desktop/package.json productName must be TeaCode`);
  }

  const requiredAssets = [
    "apps/desktop/resources/TeaCode.icon/icon.json",
    "apps/desktop/resources/icon.icns",
    "apps/desktop/resources/icon.ico",
    "apps/desktop/resources/icon.png",
    "apps/web/public/teacode-logo.png",
  ];
  for (const relativePath of requiredAssets) {
    if (!existsSync(resolve(rootDir, relativePath))) {
      errors.push(`missing required release asset ${relativePath}`);
    }
  }

  const buildScript = readFileSync(resolve(rootDir, "scripts/build-desktop-artifact.ts"), "utf8");
  if (!buildScript.includes('appId: "dev.jow.TeaCode"')) {
    errors.push("desktop artifact appId must be dev.jow.TeaCode");
  }
  if (!buildScript.includes('artifactName: "TeaCode-${version}-${arch}.${ext}"')) {
    errors.push("desktop artifact name must use TeaCode-${version}-${arch}.${ext}");
  }

  return errors;
}

function main(argv: readonly string[]): void {
  const [tag, ...rest] = argv;
  if (!tag || rest.some((value) => value !== "--allow-dirty")) {
    throw new Error("Usage: ./script/release-preflight vX.Y.Z [--allow-dirty]");
  }

  const rootDir = resolve(import.meta.dirname, "..");
  const errors = validateReleaseSource(rootDir, tag);
  if (!rest.includes("--allow-dirty")) {
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: rootDir, encoding: "utf8" });
    if (status.status !== 0 || status.stdout.trim().length > 0) {
      errors.push("release source must be a clean committed tree");
    }
  }

  if (errors.length > 0) {
    throw new Error(`TeaCode release preflight failed:\n- ${errors.join("\n- ")}`);
  }
  console.log(`TeaCode ${parseReleaseTag(tag)} release source is aligned.`);
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2));
