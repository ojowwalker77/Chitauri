// FILE: composerImageSource.ts
// Purpose: Normalizes image provenance displayed by TeaCode's composer.
// Layer: Web composer domain

export interface ComposerAppSnapSource {
  kind: "appsnap";
  captureId: string;
  capturedAt: string;
  appName: string | null;
  bundleIdentifier?: string | null;
  appIconDataUrl?: string | null;
  windowTitle: string | null;
}

export type ComposerImageSource = ComposerAppSnapSource;
export type PersistedComposerImageSource = Omit<ComposerAppSnapSource, "appIconDataUrl">;

const MAX_APP_ICON_DATA_URL_LENGTH = 256_000;

export function normalizeAppSnapIconDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_APP_ICON_DATA_URL_LENGTH) return null;
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
}

export function normalizeComposerImageSource(value: unknown): ComposerImageSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.kind !== "appsnap" && candidate.kind !== "appshot") ||
    typeof candidate.captureId !== "string" ||
    candidate.captureId.length === 0 ||
    typeof candidate.capturedAt !== "string" ||
    candidate.capturedAt.length === 0
  ) {
    return undefined;
  }

  return {
    kind: "appsnap",
    captureId: candidate.captureId,
    capturedAt: candidate.capturedAt,
    appName: typeof candidate.appName === "string" ? candidate.appName : null,
    bundleIdentifier:
      typeof candidate.bundleIdentifier === "string" ? candidate.bundleIdentifier : null,
    appIconDataUrl: normalizeAppSnapIconDataUrl(candidate.appIconDataUrl),
    windowTitle: typeof candidate.windowTitle === "string" ? candidate.windowTitle : null,
  };
}

export function toPersistedComposerImageSource(
  value: unknown,
): PersistedComposerImageSource | undefined {
  const source = normalizeComposerImageSource(value);
  if (!source) return undefined;
  const { appIconDataUrl: _appIconDataUrl, ...persisted } = source;
  return persisted;
}

export function isComposerAppSnapCaptureSource(value: unknown, captureId: string): boolean {
  if (captureId.length === 0) return false;
  const source = normalizeComposerImageSource(value);
  return source?.captureId === captureId;
}
