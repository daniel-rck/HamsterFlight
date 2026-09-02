import { C } from "@/sim/constants.ts";

/**
 * Device pixels per stage pixel.
 *
 * The backing store used to be `VIEW_W * dpr`, which ignored how large the
 * canvas actually is: the stage is laid out up to a CSS width well past 600, so
 * a 2x display was painting ~1800 device pixels from a 1200-pixel buffer and
 * upscaling the difference. Measuring the element instead makes the buffer
 * match the pixels the browser will paint.
 *
 * Capped, because the product grows quadratically - a 3x phone at a wide layout
 * would otherwise ask for a buffer several times the size of the screen.
 */
export const MAX_SCALE = 3;

export function stageScale(cssWidth: number, devicePixelRatio: number): number {
  const width = cssWidth > 0 ? cssWidth : C.VIEW_W;
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(MAX_SCALE, (width / C.VIEW_W) * dpr);
}
