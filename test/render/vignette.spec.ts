import { describe, expect, it } from "vitest";
import { VIGNETTE, VIGNETTE_STOPS, vignetteAlpha } from "@/render/scene/vignette.ts";

describe("the vignette", () => {
  it("is darker the higher the sky, and never outside its two ends", () => {
    expect(vignetteAlpha(0)).toBe(VIGNETTE.alphaDay);
    expect(vignetteAlpha(1)).toBe(VIGNETTE.alphaSpace);
    expect(vignetteAlpha(-3)).toBe(VIGNETTE.alphaDay);
    expect(vignetteAlpha(7)).toBe(VIGNETTE.alphaSpace);
    expect(vignetteAlpha(0.5)).toBeGreaterThan(vignetteAlpha(0.2));
  });

  it("stays a light touch: even the darkest corner leaves the picture readable", () => {
    expect(VIGNETTE.alphaSpace).toBeLessThan(0.5);
    expect(VIGNETTE.alphaDay).toBeGreaterThan(0);
  });

  it("ramps from clear in the middle to full at the corners, easing in", () => {
    const offsets = VIGNETTE_STOPS.map(([offset]) => offset);
    const shares = VIGNETTE_STOPS.map(([, share]) => share);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(shares[0]).toBe(0);
    expect(shares.at(-1)).toBe(1);
    // A straight line would put the middle stop at share == offset.
    const [, easeShare] = VIGNETTE_STOPS[1] ?? [0, 0];
    expect(easeShare).toBeLessThan(VIGNETTE_STOPS[1]?.[0] ?? 0);
  });

  it("starts inside the corner and reaches full past it, in unit-square distances", () => {
    // The corner of the unit square is 0.707 from the centre.
    expect(VIGNETTE.inner).toBeGreaterThan(0);
    expect(VIGNETTE.inner).toBeLessThan(VIGNETTE.outer);
    expect(VIGNETTE.outer).toBeGreaterThanOrEqual(0.7);
  });
});
