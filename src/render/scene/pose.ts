import type { SpriteId, SpriteMeta } from "@/assets/sprites.generated.ts";
import { type Box, rotateBox } from "@/sim/math/aabb.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import type { Tuning } from "@/sim/tuning.ts";

/**
 * Which hamster clip the original would have made visible, and how it is
 * turned. Shared by both renderers so the two cannot drift - this used to be
 * two copies "kept in step" by hand.
 */

/** The pose for this snapshot, in the original's visibility precedence. */
export function poseFor(s: SimSnapshot): SpriteId {
  if (s.phaseKind === "jumping" || s.phaseKind === "ready") return "hamster/jump";
  if (s.phaseKind === "settling") {
    switch (s.outcomeClip ?? s.outcome) {
      case "hole":
        return "hit/hole";
      case "cheer":
        return "hit/cheer";
      case "zero":
        return "hit/zero";
      default:
        return "hit/faceplant";
    }
  }
  const f = s.flags;
  if (f.slide && f.skidding) return "hamster/slide";
  if (f.skidding) return "hamster/skid";
  if (f.bounce || f.superbounce) return "hamster/ball";
  if (f.falling) return "hamster/drop";
  if (f.glide) return "hamster/glide";
  if (f.speed) return "hamster/blur";
  if (f.wind) return "hamster/wind";
  return "hamster/fly";
}

/**
 * `createHitClip(bc._x, bc._y + 3, ...)` for a faceplant, and the unmodified
 * position for every other outcome. Game.as:869, 874, 967. The cheer the
 * faceplant attaches takes its `this._y`, so it keeps the offset. A display
 * rule, so it lives here rather than in the simulation.
 */
export function outcomeOffsetY(s: SimSnapshot): number {
  return s.phaseKind === "settling" && s.outcome === "faceplant" ? 3 : 0;
}

/**
 * The quarter turn `createHitClip` puts on every outcome clip.
 *
 * `createHitClip(x, y, rot, type)` takes a rotation and then ignores it:
 * `hitClip._rotation = 90`, unconditionally, whatever the projectile was doing
 * when it came down. Game.as:1006-1013.
 *
 * That is not a stylistic choice, it is how the four `hit_*` symbols are
 * drawn - lying on their side, with the ground line running down the right
 * edge of the art. It reads straight off the export: `hit/cheer` ends on a
 * distance post lying flat, `hit/hole` is a crater with its sign hanging
 * sideways, and both stand up exactly when the clip is turned. Without the
 * turn the hamster lands nose-first on a vertical ground line.
 */
const OUTCOME_ROTATION = Math.PI / 2;

/**
 * Whether the hamster casts the drop shadow. `blt.shadClip._visible = false`
 * on every arm that ends a shot - Game.as:870, 876, 969 - so the outcome clip
 * casts none. Nor does the wind-up: clip 52 paints its own ellipse on the pad
 * for those frames (display-lists.txt, sprite 52, char 21 until frame 25).
 */
export function castsShadow(s: SimSnapshot): boolean {
  if (s.phaseKind === "settling") return false;
  return !(s.phaseKind === "jumping" && s.windup !== null);
}

/**
 * `Bullet.update()` - Bullet.as:42-50. The rule itself (face the velocity,
 * except crawling along the ground or with rotation switched off) lives in
 * the sim, because the pickup test measures the rotated clip; this only reads
 * `_rotation` back. It is the rotation of the arrow clip (331) as a whole -
 * authored pointing up, hence the original's `+ 90` - and each pose inside it
 * carries its own placement on top (`posePlacement`). The outcome clips are a
 * different symbol and a different question - see `OUTCOME_ROTATION`.
 */
export function hamsterRotation(s: SimSnapshot): number {
  if (s.phaseKind === "settling") return OUTCOME_ROTATION;
  if (s.phaseKind !== "flying") return 0;
  return (s.hamster.rotationDeg * Math.PI) / 180;
}

/** `[a, b, c, d, tx, ty]`, Flash's order - the same as canvas `transform()`. */
export type Affine = readonly [number, number, number, number, number, number];

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/**
 * Where a pose sits inside the arrow clip, straight off its PlaceObject2
 * (display-lists.txt, sprite 331). Not every pose is authored the same way
 * round: `flying_mc` and `drop` are drawn facing right and placed a quarter
 * turn anticlockwise, `glide` is placed at 0.9 scale, and `wind`, `blur`,
 * `slide`, `skid` and `ball` are drawn pointing up and placed as they are.
 *
 * Subtracting the `+ 90` from every pose, as this used to, was right for
 * `flying_mc` alone: a skid or a skateboard slide - rotation pinned at 90 on
 * the ground - drew the hamster standing next to a board on its end instead of
 * lying on it.
 */
export function posePlacement(meta: SpriteMeta): Affine {
  return meta.placement ?? IDENTITY;
}

/** The hamster's hit box as the sim tests it: the flight core turns with the clip. */
export function hamsterBox(s: SimSnapshot, tuning: Tuning): Box {
  return s.phaseKind === "flying"
    ? rotateBox(tuning.boxes.hamsterFlightCore, s.hamster.rotationDeg)
    : tuning.boxes.hamsterJumpCore;
}
