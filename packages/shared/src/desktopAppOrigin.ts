// FILE: desktopAppOrigin.ts
// Purpose: Single source of truth for the packaged desktop custom scheme and the
//          origin its renderer sends to the backend.
// Layer: Shared constants
// Exports: DESKTOP_SCHEME, DESKTOP_APP_HOST, DESKTOP_APP_CORS_ORIGIN

export const DESKTOP_SCHEME = "teacode";
export const LEGACY_DESKTOP_SCHEME = "chitauri";

/** Host segment of the packaged renderer URL (`teacode://app/index.html`). */
export const DESKTOP_APP_HOST = "app";

// The packaged renderer is served from a non-special scheme, so `new URL(...).origin`
// serializes to the opaque "null" instead of `teacode://app`. Every origin check
// against the desktop renderer must compare this literal, and it must be derived from
// the same scheme the renderer is actually loaded with: a scheme rename that misses
// this constant silently 403s the app's own WebSocket upgrade.
export const DESKTOP_APP_CORS_ORIGIN = `${DESKTOP_SCHEME}://${DESKTOP_APP_HOST}`;
export const LEGACY_DESKTOP_APP_CORS_ORIGIN = `${LEGACY_DESKTOP_SCHEME}://${DESKTOP_APP_HOST}`;
