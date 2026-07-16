import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import OS from "node:os";

export interface TargetFingerprint {
  readonly realPath: string;
  readonly mtimeMs: number;
  readonly size: number;
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

export async function fingerprintDirectory(path: string): Promise<TargetFingerprint | null> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const realPath = await fs.realpath(path);
    return {
      realPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      kind: "directory",
    };
  } catch {
    return null;
  }
}

export function encodeFingerprint(fingerprint: TargetFingerprint, bytes: number): string {
  return JSON.stringify({
    realPath: fingerprint.realPath,
    mtimeMs: Math.round(fingerprint.mtimeMs),
    size: fingerprint.size,
    bytes,
    kind: fingerprint.kind,
  });
}

export function fingerprintMatches(
  fingerprint: TargetFingerprint,
  encoded: string,
  bytes: number | null,
): boolean {
  try {
    const parsed = JSON.parse(encoded) as Partial<TargetFingerprint> & { bytes?: unknown };
    return (
      parsed.realPath === fingerprint.realPath &&
      Math.round(Number(parsed.mtimeMs)) === Math.round(fingerprint.mtimeMs) &&
      parsed.size === fingerprint.size &&
      parsed.kind === fingerprint.kind &&
      (bytes === null || parsed.bytes === bytes)
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
}): Promise<{ ok: true; realPath: string; fingerprint: TargetFingerprint } | { ok: false; reason: string }> {
  const fingerprint = await fingerprintDirectory(input.target);
  if (!fingerprint) return { ok: false, reason: "Target is missing, not a directory, or is a symlink." };
  if (isProtectedRoot(fingerprint.realPath, input.protectedRoots)) {
    return { ok: false, reason: "Target is protected by Chitauri safety rules." };
  }
  if (!input.allowlist(fingerprint.realPath)) {
    return { ok: false, reason: "Target no longer matches the utility allowlist." };
  }
  const contained = input.roots.some((root) => isStrictlyInside(root, fingerprint.realPath));
  if (!contained) return { ok: false, reason: "Target is outside the approved scan roots." };
  return { ok: true, realPath: fingerprint.realPath, fingerprint };
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
