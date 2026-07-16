import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import OS from "node:os";

export interface TargetFingerprint {
  readonly realPath: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly bytes: number;
  readonly treeDigest: string;
  readonly kind: "directory";
}

export async function canonicalizeExistingDirectory(path: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    return await fs.realpath(path);
  } catch {
    return null;
  }
}

export function isStrictlyInside(root: string, target: string): boolean {
  const relative = nodePath.relative(root, target);
  return relative.length > 0 && !relative.startsWith("..") && !nodePath.isAbsolute(relative);
}

export function isFilesystemRoot(path: string): boolean {
  const parsed = nodePath.parse(path);
  return nodePath.resolve(path) === parsed.root;
}

export function isProtectedRoot(path: string, protectedRoots: readonly string[]): boolean {
  const resolved = nodePath.resolve(path);
  if (isFilesystemRoot(resolved)) return true;
  return protectedRoots.some((root) => resolved === root || isStrictlyInside(root, resolved));
}

export async function resolveApprovedRoots(input: {
  readonly roots: readonly string[];
  readonly fallbackRoot: string;
  readonly homeDir: string;
  readonly protectedRoots: readonly string[];
}): Promise<string[]> {
  const rawRoots = input.roots.length > 0 ? input.roots : [input.fallbackRoot];
  const roots = new Set<string>();
  for (const root of rawRoots) {
    const canonical = await canonicalizeExistingDirectory(root);
    if (!canonical) continue;
    if (canonical === input.homeDir || isProtectedRoot(canonical, input.protectedRoots)) continue;
    roots.add(canonical);
  }
  return [...roots].sort((left, right) => left.localeCompare(right));
}

export async function fingerprintDirectory(
  path: string,
  signal?: AbortSignal,
): Promise<TargetFingerprint | null> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const realPath = await fs.realpath(path);
    const hash = createHash("sha256");
    let bytes = stat.size;

    const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
      if (signal?.aborted) throw new Error("cancelled");
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (signal?.aborted) throw new Error("cancelled");
        const child = nodePath.join(directory, entry.name);
        const relativePath = nodePath.join(relativeDirectory, entry.name);
        const childStat = await fs.lstat(child);
        const kind = childStat.isSymbolicLink()
          ? "symlink"
          : childStat.isDirectory()
            ? "directory"
            : childStat.isFile()
              ? "file"
              : "other";
        bytes += childStat.size;
        hash.update(
          JSON.stringify([
            relativePath,
            kind,
            childStat.size,
            Math.round(childStat.mtimeMs),
            Math.round(childStat.ctimeMs),
          ]),
        );
        if (kind === "directory") await walk(child, relativePath);
      }
    };

    hash.update(
      JSON.stringify([
        ".",
        "directory",
        stat.size,
        Math.round(stat.mtimeMs),
        Math.round(stat.ctimeMs),
      ]),
    );
    await walk(realPath, "");
    return {
      realPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      bytes,
      treeDigest: hash.digest("hex"),
      kind: "directory",
    };
  } catch {
    return null;
  }
}

export function encodeFingerprint(fingerprint: TargetFingerprint): string {
  return JSON.stringify({
    realPath: fingerprint.realPath,
    mtimeMs: Math.round(fingerprint.mtimeMs),
    size: fingerprint.size,
    bytes: fingerprint.bytes,
    treeDigest: fingerprint.treeDigest,
    kind: fingerprint.kind,
  });
}

export function fingerprintMatches(fingerprint: TargetFingerprint, encoded: string): boolean {
  try {
    const parsed = JSON.parse(encoded) as Partial<TargetFingerprint>;
    return (
      parsed.realPath === fingerprint.realPath &&
      Math.round(Number(parsed.mtimeMs)) === Math.round(fingerprint.mtimeMs) &&
      parsed.size === fingerprint.size &&
      parsed.kind === fingerprint.kind &&
      parsed.bytes === fingerprint.bytes &&
      parsed.treeDigest === fingerprint.treeDigest
    );
  } catch {
    return false;
  }
}

export async function validateDeletionTarget(input: {
  readonly target: string;
  readonly roots: readonly string[];
  readonly protectedRoots: readonly string[];
  readonly allowlist: (path: string) => boolean;
}): Promise<{ ok: true; realPath: string } | { ok: false; reason: string }> {
  const realPath = await canonicalizeExistingDirectory(input.target);
  if (!realPath)
    return { ok: false, reason: "Target is missing, not a directory, or is a symlink." };
  if (isProtectedRoot(realPath, input.protectedRoots)) {
    return { ok: false, reason: "Target is protected by Chitauri safety rules." };
  }
  if (!input.allowlist(realPath)) {
    return { ok: false, reason: "Target no longer matches the utility allowlist." };
  }
  const contained = input.roots.some((root) => isStrictlyInside(root, realPath));
  if (!contained) return { ok: false, reason: "Target is outside the approved scan roots." };
  return { ok: true, realPath };
}

export function defaultProtectedRoots(input: {
  readonly homeDir: string;
  readonly stateDir: string;
  readonly baseDir: string;
}): string[] {
  return [
    nodePath.resolve(input.stateDir),
    nodePath.resolve(input.baseDir),
    nodePath.resolve(OS.tmpdir()),
  ];
}
