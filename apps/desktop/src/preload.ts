import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@t3tools/contracts";
import {
  DESKTOP_WS_URL_CHANNEL,
  normalizeDesktopWsUrl,
  resolveDesktopWsUrlFromEnv,
} from "./desktopWsBridge";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

const {
  pickFolder: PICK_FOLDER_CHANNEL,
  saveFile: SAVE_FILE_CHANNEL,
  confirm: CONFIRM_CHANNEL,
  setTheme: SET_THEME_CHANNEL,
  contextMenu: CONTEXT_MENU_CHANNEL,
  openExternal: OPEN_EXTERNAL_CHANNEL,
  showInFolder: SHOW_IN_FOLDER_CHANNEL,
  clipboardWriteImage: CLIPBOARD_WRITE_IMAGE_CHANNEL,
  windowMinimize: WINDOW_MINIMIZE_CHANNEL,
  windowToggleMaximize: WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  windowClose: WINDOW_CLOSE_CHANNEL,
  windowGetState: WINDOW_GET_STATE_CHANNEL,
  windowState: WINDOW_STATE_CHANNEL,
  menuAction: MENU_ACTION_CHANNEL,
  updateState: UPDATE_STATE_CHANNEL,
  updateGetState: UPDATE_GET_STATE_CHANNEL,
  updateCheck: UPDATE_CHECK_CHANNEL,
  updateDownload: UPDATE_DOWNLOAD_CHANNEL,
  updateInstall: UPDATE_INSTALL_CHANNEL,
  notificationsIsSupported: NOTIFICATIONS_IS_SUPPORTED_CHANNEL,
  notificationsShow: NOTIFICATIONS_SHOW_CHANNEL,
  zoomFactor: ZOOM_FACTOR_CHANNEL,
  zoomFactorChanged: ZOOM_FACTOR_CHANGED_CHANNEL,
  appSnap: APP_SNAP_CHANNELS,
} = DESKTOP_IPC_CHANNELS;

function getDesktopWsUrl(): string | null {
  try {
    const ipcWsUrl = normalizeDesktopWsUrl(ipcRenderer.sendSync(DESKTOP_WS_URL_CHANNEL));
    return ipcWsUrl ?? resolveDesktopWsUrlFromEnv(process.env);
  } catch {
    return resolveDesktopWsUrlFromEnv(process.env);
  }
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: getDesktopWsUrl,
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  saveFile: (input) => ipcRenderer.invoke(SAVE_FILE_CHANNEL, input),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  showInFolder: (path: string) => ipcRenderer.invoke(SHOW_IN_FOLDER_CHANNEL, path),
  shell: {
    showInFolder: (path: string) => ipcRenderer.invoke(SHOW_IN_FOLDER_CHANNEL, path),
  },
  clipboard: {
    writeImagePngDataUrl: (dataUrl: string) =>
      ipcRenderer.invoke(CLIPBOARD_WRITE_IMAGE_CHANNEL, dataUrl),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke(WINDOW_MINIMIZE_CHANNEL),
    toggleMaximize: () => ipcRenderer.invoke(WINDOW_TOGGLE_MAXIMIZE_CHANNEL),
    close: () => ipcRenderer.invoke(WINDOW_CLOSE_CHANNEL),
    getState: () => ipcRenderer.invoke(WINDOW_GET_STATE_CHANNEL),
    onState: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as Parameters<typeof listener>[0]);
      };

      ipcRenderer.on(WINDOW_STATE_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(WINDOW_STATE_CHANNEL, wrappedListener);
      };
    },
  },
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getZoomFactor: () => {
    const factor = ipcRenderer.sendSync(ZOOM_FACTOR_CHANNEL);
    return typeof factor === "number" && Number.isFinite(factor) && factor > 0 ? factor : 1;
  },
  onZoomFactorChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, factor: unknown) => {
      if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) return;
      listener(factor);
    };

    ipcRenderer.on(ZOOM_FACTOR_CHANGED_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(ZOOM_FACTOR_CHANGED_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdates: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  notifications: {
    isSupported: () => ipcRenderer.invoke(NOTIFICATIONS_IS_SUPPORTED_CHANNEL),
    show: (input) => ipcRenderer.invoke(NOTIFICATIONS_SHOW_CHANNEL, input),
  },
  appSnap: {
    getState: () => ipcRenderer.invoke(APP_SNAP_CHANNELS.getState),
    setEnabled: (enabled) => ipcRenderer.invoke(APP_SNAP_CHANNELS.setEnabled, enabled),
    setChord: (chord) => ipcRenderer.invoke(APP_SNAP_CHANNELS.setChord, chord),
    requestPermissions: () => ipcRenderer.invoke(APP_SNAP_CHANNELS.requestPermissions),
    listPendingCaptures: () => ipcRenderer.invoke(APP_SNAP_CHANNELS.listPendingCaptures),
    acknowledgeCapture: (captureId) =>
      ipcRenderer.invoke(APP_SNAP_CHANNELS.acknowledgeCapture, captureId),
    onCaptured: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, capture: unknown) => {
        if (capture && typeof capture === "object") {
          listener(capture as Parameters<typeof listener>[0]);
        }
      };
      ipcRenderer.on(APP_SNAP_CHANNELS.captured, wrapped);
      return () => ipcRenderer.removeListener(APP_SNAP_CHANNELS.captured, wrapped);
    },
    onError: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, error: unknown) => {
        if (error && typeof error === "object") {
          listener(error as Parameters<typeof listener>[0]);
        }
      };
      ipcRenderer.on(APP_SNAP_CHANNELS.error, wrapped);
      return () => ipcRenderer.removeListener(APP_SNAP_CHANNELS.error, wrapped);
    },
    onState: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => {
        if (state && typeof state === "object") {
          listener(state as Parameters<typeof listener>[0]);
        }
      };
      ipcRenderer.on(APP_SNAP_CHANNELS.state, wrapped);
      return () => ipcRenderer.removeListener(APP_SNAP_CHANNELS.state, wrapped);
    },
  },
} satisfies DesktopBridge);
