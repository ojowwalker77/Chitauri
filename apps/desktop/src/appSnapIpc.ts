// FILE: appSnapIpc.ts
// Purpose: Registers validated renderer commands for the desktop AppSnap manager.

import { ipcMain } from "electron";
import { isDesktopAppSnapChord, type DesktopAppSnapManager } from "./appSnapManager";
import { DESKTOP_IPC_CHANNELS } from "./ipcChannels";

export function registerAppSnapIpc(manager: DesktopAppSnapManager): () => void {
  const channels = DESKTOP_IPC_CHANNELS.appSnap;
  ipcMain.removeHandler(channels.getState);
  ipcMain.removeHandler(channels.setEnabled);
  ipcMain.removeHandler(channels.setChord);
  ipcMain.removeHandler(channels.requestPermissions);
  ipcMain.removeHandler(channels.listPendingCaptures);
  ipcMain.removeHandler(channels.acknowledgeCapture);

  ipcMain.handle(channels.getState, () => manager.refreshState());
  ipcMain.handle(channels.setEnabled, (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid AppSnap enabled state.");
    return manager.setEnabled(enabled);
  });
  ipcMain.handle(channels.setChord, (_event, chord: unknown) => {
    if (!isDesktopAppSnapChord(chord)) throw new Error("Invalid AppSnap chord.");
    return manager.setChord(chord);
  });
  ipcMain.handle(channels.requestPermissions, () => manager.requestPermissions());
  ipcMain.handle(channels.listPendingCaptures, () => manager.listPendingCaptures());
  ipcMain.handle(channels.acknowledgeCapture, (_event, captureId: unknown) => {
    if (typeof captureId !== "string" || captureId.length === 0 || captureId.length > 128) {
      throw new Error("Invalid AppSnap capture id.");
    }
    return manager.acknowledgeCapture(captureId);
  });

  return () => {
    ipcMain.removeHandler(channels.getState);
    ipcMain.removeHandler(channels.setEnabled);
    ipcMain.removeHandler(channels.setChord);
    ipcMain.removeHandler(channels.requestPermissions);
    ipcMain.removeHandler(channels.listPendingCaptures);
    ipcMain.removeHandler(channels.acknowledgeCapture);
  };
}
