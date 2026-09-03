import type { SpriteId } from "@/assets/sprites.generated.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/**
 * Which hamster clip the original would have made visible, and how it is
 * turned. Shared by both renderers so the two cannot drift - this used to be
 * two copies "kept in step" by hand.
 */

/** The pose for this snapshot, in the original's visibility precedence. */
export function poseFor(s: SimSnapshot): SpriteId {
  if (s.phaseKind === "jumping" || s.phaseKind === "ready") return "hamster/jump";
  if (s.phaseKind === "settling") {
    switch (s.outcome) {
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
 * position for every other outcome. Game.as:869, 874, 967. A display rule, like
 * the no-rotate one below, so it lives here rather than in the simulation.
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
 * How many stage px to leave off the bottom of the hamster's own clip.
 *
 * `hamster/jump` carries its pad shadow in its own art - the ellipse under the
 * feet, the bottom few px of every standing frame. Char 52 animates a leap
 * that *leaves that ellipse behind* (its takeoff frames lift the hamster out
 * of the box while the ellipse stays at the bottom), so the clip was authored
 * to be played where it stands. `jumpFrame()` moves it instead - `hamster._y
 * += yvel`, Game.as:1082 - and the painted-on shadow rode up into the sky with
 * the hamster, which is the one thing a shadow may never do.
 *
 * Dropping the strip for the length of the jump is a display rule, like the
 * faceplant's `+ 3` and the no-rotate one: the shadow is on the pad while the
 * hamster is on the pad, and gone the moment it leaves. Measured off the
 * frames, the ellipse is the bottom 6 px; the feet end 2 px above that.
 */
export const JUMP_SHADOW_STRIP = 6;

export function bottomCrop(s: SimSnapshot): number {
  return s.phaseKind === "jumping" ? JUMP_SHADOW_STRIP : 0;
}

/**
 * `Bullet.update()` - Bullet.as:42-47. The clip turns to face its velocity,
 * except while crawling along the ground (`xvel < 7 && y > 940` - the signed
 * xvel, as written) or when a skid has switched rotation off. The original
 * adds 90 because the projectile's art is authored pointing up; the exported
 * flight poses face right, so the sprite aligns with the velocity directly.
 * The outcome clips are a different symbol and a different question - see
 * `OUTCOME_ROTATION`.
 */
export function hamsterRotation(s: SimSnapshot): number {
  if (s.phaseKind === "settling") return OUTCOME_ROTATION;
  if (s.phaseKind !== "flying") return 0;
  const h = s.hamster;
  if (!h.doRotation) return 0;
  if (h.xvel < C.NO_ROTATE_XVEL && h.y > C.NO_ROTATE_Y) return 0;
  return Math.atan2(h.yvel, h.xvel);
}
