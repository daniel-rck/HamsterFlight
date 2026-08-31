/**
 * Flash's `MovieClip.hitTest(target)` is an axis-aligned bounding-box test in
 * global space - not a circle, not shape-accurate. Every collision in the game
 * goes through it, so the port models it directly.
 */

/**
 * A box in its owning clip's local space: half-extents plus the offset of the
 * box centre from the clip's registration point. Stored this way because that
 * is exactly what the SWF shape bounds constrain - see `hitboxes.generated.ts`.
 */
export interface Box {
  readonly hw: number;
  readonly hh: number;
  readonly cx: number;
  readonly cy: number;
}

/**
 * True when two boxes overlap. Touching edges count as a hit, matching Flash,
 * hence `<=` rather than `<`.
 */
export function overlaps(ax: number, ay: number, a: Box, bx: number, by: number, b: Box): boolean {
  return (
    Math.abs(ax + a.cx - (bx + b.cx)) <= a.hw + b.hw &&
    Math.abs(ay + a.cy - (by + b.cy)) <= a.hh + b.hh
  );
}
