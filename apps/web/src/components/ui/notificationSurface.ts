// FILE: notificationSurface.ts
// Purpose: Shared visual tokens for transient and inline notification surfaces.
// Layer: UI styling helper
// Exports: notification surface class names used by toast and status banners.

import { OVERLAY_SURFACE_CLASS_NAME } from "~/components/ui/surface";

// `--notification-fg` keeps the text/icon/control color readable against the
// accent-tinted surface. It tracks the theme's own foreground token, so it is
// near-black in light themes and near-white in dark themes automatically —
// without depending on the `.dark` class. Children reference it via
// `text-[var(--notification-fg)]` so the contrast fix lives in one place for
// both toasts and inline notification banners.
const NOTIFICATION_FOREGROUND_CLASS_NAME =
  "text-[var(--notification-fg)] [--notification-fg:var(--color-text-foreground)]";

// `[-webkit-app-region:no-drag]` keeps the card (and every control inside it,
// notably the dismiss "X") clickable in the desktop app. Toasts render at the
// top edge over Electron's draggable titlebar region; without this the OS
// captures clicks in that band for window dragging and the X stops working.
export const COMPACT_NOTIFICATION_SURFACE_CLASS_NAME = `${OVERLAY_SURFACE_CLASS_NAME} w-max max-w-[min(calc(100vw-2rem),28rem)] rounded-[11px] dark:bg-[#262626] ${NOTIFICATION_FOREGROUND_CLASS_NAME} before:hidden [-webkit-app-region:no-drag]`;

export const EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME = `${OVERLAY_SURFACE_CLASS_NAME} w-full rounded-[11px] dark:bg-[#262626] ${NOTIFICATION_FOREGROUND_CLASS_NAME} before:hidden [-webkit-app-region:no-drag]`;

export const NOTIFICATION_ICON_CLASS_NAME = "text-muted-foreground";
