// FILE: desktopStaticProtocol.ts
// Purpose: Defines cache-safe responses for packaged renderer assets.
// Layer: Desktop protocol helpers
// Exports: createDesktopStaticFileResponse

const DESKTOP_STATIC_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Expires: "0",
  Pragma: "no-cache",
} as const;

export function createDesktopStaticFileResponse(path: string): {
  readonly headers: Record<string, string>;
  readonly path: string;
} {
  return {
    headers: { ...DESKTOP_STATIC_RESPONSE_HEADERS },
    path,
  };
}
