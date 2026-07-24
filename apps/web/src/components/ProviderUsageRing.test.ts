import { describe, expect, it } from "vitest";

import { usageRingGeometry } from "./ProviderUsageRing";

describe("usageRingGeometry", () => {
  const size = 14;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  it("fills the whole ring at full remaining budget", () => {
    const geometry = usageRingGeometry(100, size, strokeWidth);
    expect(geometry.filled).toBeCloseTo(circumference);
    expect(geometry.circumference - geometry.filled).toBeCloseTo(0);
  });

  it("leaves the ring empty at zero remaining budget", () => {
    const geometry = usageRingGeometry(0, size, strokeWidth);
    expect(geometry.filled).toBe(0);
  });

  it("fills proportionally to remaining percent", () => {
    const geometry = usageRingGeometry(25, size, strokeWidth);
    expect(geometry.filled).toBeCloseTo(circumference * 0.25);
  });

  it("clamps out-of-range values into 0-100", () => {
    expect(usageRingGeometry(140, size, strokeWidth).clamped).toBe(100);
    expect(usageRingGeometry(-20, size, strokeWidth).clamped).toBe(0);
  });
});
