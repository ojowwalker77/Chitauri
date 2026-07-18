// FILE: AppSnapWelcomeDialog.tsx
// Purpose: One-time, informational AppSnap introduction for supported macOS desktop profiles.

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

const APP_SNAP_WELCOME_STORAGE_KEY = "teacode:appsnap-welcome:v1";

export function AppSnapWelcomeDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(APP_SNAP_WELCOME_STORAGE_KEY) === "1") return;
    const bridge = window.desktopBridge?.appSnap;
    if (!bridge) return;
    let disposed = false;
    void bridge
      .getState()
      .then((state) => {
        if (!disposed && state.supported) setOpen(true);
      })
      .catch((error) => console.warn("[appsnap] Could not read welcome state", error));
    return () => {
      disposed = true;
    };
  }, []);

  const acknowledge = () => {
    localStorage.setItem(APP_SNAP_WELCOME_STORAGE_KEY, "1");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) acknowledge();
      }}
    >
      <DialogPopup className="max-w-md gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="p-5 pb-3">
          <DialogTitle>Capture any app into TeaCode</DialogTitle>
          <DialogDescription>
            AppSnap adds the frontmost macOS window to the task you were just using.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="px-5 py-3">
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Press the physical left and right Option keys together. TeaCode captures one window,
              brings your task forward, and leaves the image in the composer for review.
            </p>
            <p>
              AppSnap is off by default. Setup asks for Input Monitoring and Screen Recording only
              after you choose to enable it. Nothing is uploaded until you send the message.
            </p>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={acknowledge}>
            Not now
          </Button>
          <Button
            onClick={() => {
              acknowledge();
              void navigate({ to: "/settings", search: { section: "appsnap" } });
            }}
          >
            Set up AppSnap
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
