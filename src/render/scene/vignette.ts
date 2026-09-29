import { clamp, type Rgb } from "@/render/scene/decor.ts";

/**
 * A soft darkening toward the corners, drawn over the picture and under the
 * HUD. It pulls the eye to the middle, where the hamster is, and glues the
 * layers together: sky, hills and ground read as one lit scene instead of
 * flat bands. Both backends draw it the same way - a radial ramp over the unit
 * square, stretched to the stage - so it needs no shader and costs no
 * full-screen pass; the WebGL scene carries no filter at rest and still has this.
 *
 * `inner` and `outer` are distances from the centre in unit-square terms: the
 * ramp starts at `inner` and is full at `outer`, and the corner is 0.707 away.
 */
export const VIGNETTE = {
  inner: 0.3,
  outer: 0.72,
  colour: [12, 22, 48] as Rgb,
  /** Opacity at the corners on the ground, and up in the dark. */
  alphaDay: 0.26,
  alphaSpace: 0.42,
  /** Where the ramp is a quarter of the way, so the falloff eases in rather than ramping. */
  easeAt: 0.55,
  easeShare: 0.3,
} as const;

/** The corner opacity at an altitude fraction: stronger the darker the sky. */
export function vignetteAlpha(altitude: number): number {
  const t = clamp(altitude, 0, 1);
  return VIGNETTE.alphaDay + (VIGNETTE.alphaSpace - VIGNETTE.alphaDay) * t;
}

/** Colour stops of the ramp, 0 at `inner` to 1 at `outer`, at full opacity. */
export const VIGNETTE_STOPS: readonly (readonly [offset: number, share: number])[] = [
  [0, 0],
  [VIGNETTE.easeAt, VIGNETTE.easeShare],
  [1, 1],
];
