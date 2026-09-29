/**
 * The streak behind a fast hamster, as a pure function of where it has been.
 *
 * The points are the hamster's own positions at the last few ticks, so the
 * trail is the same on a 60 Hz display as on a 144 Hz one and on every replay of
 * a seed - nothing in it samples the frame clock. Presentation only.
 */

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
}

export interface TrailSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly width: number;
  readonly alpha: number;
}

export const TRAIL = {
  /** How many past ticks it reaches back. At 20 Hz that is about 0.4 s. */
  ticks: 8,
  /** Width and opacity at the hamster, before they taper to nothing. */
  width: 6,
  alpha: 0.42,
  colour: 0xffffff,
  /** Speed, in stage px per tick, below which there is no trail and above which it is full. */
  speedFrom: 9,
  speedSpan: 14,
} as const;

/** 0 while slow, 1 at full speed. */
export function trailStrength(speed: number): number {
  return Math.min(1, Math.max(0, (speed - TRAIL.speedFrom) / TRAIL.speedSpan));
}

/**
 * Segments from the head back along `past` (newest first), each thinner and
 * fainter than the one before. A segment that goes nowhere is left out.
 */
export function trailSegments(
  head: TrailPoint,
  past: readonly TrailPoint[],
  strength: number,
): readonly TrailSegment[] {
  if (strength <= 0) return [];
  const out: TrailSegment[] = [];
  let from = head;
  for (const [i, to] of past.entries()) {
    const taper = 1 - (i + 1) / (past.length + 1);
    if (to.x !== from.x || to.y !== from.y) {
      out.push({
        x0: from.x,
        y0: from.y,
        x1: to.x,
        y1: to.y,
        width: TRAIL.width * taper * strength,
        alpha: TRAIL.alpha * taper * strength,
      });
    }
    from = to;
  }
  return out;
}
