/**
 * A white dot that fades to nothing at its rim, painted once and shared by
 * every particle in both backends - Pixi wraps it in a texture, Canvas2D blits
 * it - so a spark is the same round glow on either. Null where there is no 2D
 * context to paint it with, in which case the caller falls back to a square.
 */
export const SOFT_DOT_SIZE = 32;

/** How much wider than its `size` a particle is drawn, to leave room for the fade. */
export const SOFT_DOT_SCALE = 2.2;

export function softDotCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SOFT_DOT_SIZE;
  canvas.height = SOFT_DOT_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const half = SOFT_DOT_SIZE / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.8)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SOFT_DOT_SIZE, SOFT_DOT_SIZE);
  return canvas;
}
