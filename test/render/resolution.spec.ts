import { describe, expect, it } from "vitest";
import { densityFor } from "@/assets/AssetLoader.ts";
import { MAX_SCALE, stageScale } from "@/render/resolution.ts";

describe("atlas density selection", () => {
  it("takes the smallest sheet that still covers the display", () => {
    expect(densityFor(1)).toBe(1);
    expect(densityFor(1.25)).toBe(2);
    expect(densityFor(2)).toBe(2);
  });

  it("falls back to the densest sheet there is, rather than none", () => {
    expect(densityFor(3)).toBe(2);
    expect(densityFor(0.5)).toBe(1);
  });
});

describe("stage scale", () => {
  it("follows how large the canvas actually is, not just the device ratio", () => {
    // The old rule was min(dpr, 2) and ignored the layout entirely, so a 2x
    // screen on a wide stage painted more pixels than the buffer held.
    expect(stageScale(600, 1)).toBe(1);
    expect(stageScale(1200, 1)).toBe(2);
    expect(stageScale(900, 2)).toBe(3);
  });

  it("is capped, because the buffer grows with the square of it", () => {
    expect(stageScale(1600, 3)).toBe(MAX_SCALE);
    expect(stageScale(4000, 2)).toBe(MAX_SCALE);
  });

  it("survives a layout that has not been measured yet", () => {
    expect(stageScale(0, 0)).toBe(1);
  });
});
