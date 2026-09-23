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
 * The stage-space box of a clip-local box on a clip turned by `_rotation`
 * degrees. `hitTest(clip)` compares bounds in global space, and the global
 * bounds of a rotated rectangle are the axis-aligned box around its four
 * turned corners: the centre offset turns with the clip, the half-extents
 * mix. Flash turns `_rotation` into the clip matrix with its own full-precision
 * pi, so `Math.PI` is right here - `PI_AS2` belongs to the game's own maths.
 */
export function rotateBox(box: Box, degrees: number): Box {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ac = Math.abs(cos);
  const as = Math.abs(sin);
  return {
    hw: ac * box.hw + as * box.hh,
    hh: as * box.hw + ac * box.hh,
    cx: box.cx * cos - box.cy * sin,
    cy: box.cx * sin + box.cy * cos,
  };
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
