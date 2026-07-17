// FILE: ThreadRunningSpinner.tsx
// Purpose: Shared inline running/pulse spinner for sidebar thread status slots.
// Layer: Sidebar UI primitive
// Exports: ThreadRunningSpinner

import { cn } from "~/lib/utils";

export function ThreadRunningSpinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "thread-running-spinner inline-block size-3.5 shrink-0 animate-spin rounded-full text-muted-foreground [animation-duration:800ms] motion-reduce:animate-none",
        className,
      )}
      style={{
        background:
          "conic-gradient(from 0deg, color-mix(in srgb, currentColor 25%, transparent) 0 75%, currentColor 75% 100%)",
        mask: "radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))",
        WebkitMask:
          "radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))",
      }}
    />
  );
}
