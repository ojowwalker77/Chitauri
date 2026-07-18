// FILE: desktopWsBridge.ts
// Purpose: Shares the desktop WebSocket bridge channel and env fallback rules.
// Exports: channel name plus helpers used by Electron main, preload, and tests.

import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

export const DESKTOP_WS_URL_CHANNEL = DESKTOP_IPC_CHANNELS.wsUrl;

export function normalizeDesktopWsUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveDesktopWsUrlFromEnv(env: NodeJS.ProcessEnv): string | null {
  return normalizeDesktopWsUrl(env.TEACODE_DESKTOP_WS_URL ?? env.CHITAURI_DESKTOP_WS_URL);
}
