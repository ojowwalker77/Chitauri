// FILE: TeaCodeLogo.tsx
// Purpose: Render the canonical TeaCode icon across app surfaces.

import type { ImgHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export function TeaCodeLogo({ className, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src="/teacode-logo.png"
      alt={alt ?? ""}
      draggable={false}
      {...props}
      className={cn("shrink-0", className)}
    />
  );
}
