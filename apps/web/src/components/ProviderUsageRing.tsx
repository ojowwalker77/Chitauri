// FILE: ProviderUsageRing.tsx
// Purpose: Compact donut ring showing how much provider quota is left, colored by
// the same tone the usage bars use (green healthy -> red nearly empty). Shared so
// the composer underbar and any future glanceable surface stay identical.

import { cn } from "~/lib/utils";
import type { ProviderUsageTone } from "~/lib/providerUsageDisplay";

const TONE_STROKE_CLASS_NAME: Record<ProviderUsageTone, string> = {
  healthy: "stroke-success",
  warning: "stroke-destructive",
  danger: "stroke-destructive",
};

export interface UsageRingGeometry {
  clamped: number;
  radius: number;
  circumference: number;
  filled: number;
}

// The arc length reflects REMAINING budget, so a full ring means full quota and a
// thin arc means nearly exhausted — matching "colored based on what's left".
export function usageRingGeometry(
  remainingPercent: number,
  size: number,
  strokeWidth: number,
): UsageRingGeometry {
  const clamped = Math.min(100, Math.max(0, remainingPercent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (clamped / 100) * circumference;
  return { clamped, radius, circumference, filled };
}

export function ProviderUsageRing({
  remainingPercent,
  tone,
  size = 14,
  strokeWidth = 2.5,
  className,
}: {
  remainingPercent: number;
  tone: ProviderUsageTone;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const { radius, circumference, filled } = usageRingGeometry(remainingPercent, size, strokeWidth);
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <g transform={`rotate(-90 ${center} ${center})`}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-border"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          className={cn(
            "transition-[stroke-dasharray] duration-500 motion-reduce:transition-none",
            TONE_STROKE_CLASS_NAME[tone],
          )}
        />
      </g>
    </svg>
  );
}
