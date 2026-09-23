import { C } from "../constants.ts";
import { radToDeg } from "../math/angles.ts";
import { toTwips } from "../math/twips.ts";

/**
 * The hamster in flight - a direct port of `reference/as2/Bullet.as` with the
 * display side (clip, shadow) removed. The clip's `_rotation` stays: the
 * pickup test measures the rotated clip, so it is physics.
 *
 * `ox`/`oy` are load-bearing physics state, not a rendering convenience: the
 * ground-impact angle is measured from them (Game.as:799-801), and because
 * `update()` captures them *before* moving, the vertical delta they produce
 * spans two ticks while the horizontal delta spans one. Dropping them, or
 * substituting `atan2(yvel, xvel)`, changes which impacts count as faceplants.
 */
export class Projectile {
  x: number;
  y: number;
  xvel: number;
  yvel: number;
  /** Position at the start of the previous integration. Bullet.as:42-43. */
  ox: number;
  oy: number;
  grav: number;
  hit = false;
  /** Toggled by slide/skid; feeds `rotationDeg`, and through it the pickup box. */
  doRotation = true;
  /**
   * `bltClip._rotation` in degrees, as `update()` last wrote it. The pickup
   * test runs before `update()` in the tick (Game.as:504 vs :630), so it sees
   * the value from the previous tick. Starts as `setClipPos()`'s
   * `_rotation = this.ang` (Bullet.as:79) - the launch angle in radians,
   * written into a degrees property as the original does.
   */
  rotationDeg: number;

  constructor(x: number, y: number, vel: number, angleRad: number, gravity: number) {
    this.x = x;
    this.y = y;
    this.grav = gravity;
    // Bullet.init(): xvel = sin(ang) * vel, yvel = -cos(ang) * vel
    this.xvel = Math.sin(angleRad) * vel;
    this.yvel = -Math.cos(angleRad) * vel;
    // The original leaves ox/oy undefined until the first update. Seeding them
    // with the spawn position is a divergence on an unreachable path: a ground
    // contact on flight tick 0 would need |yvel| > 191 from y = 759.
    this.ox = x;
    this.oy = y;
    this.rotationDeg = angleRad;
  }

  /**
   * `Bullet.update()` - order matters: ox/oy and the rotation are taken
   * before the move, so the no-rotate test sees the pre-move y. Bullet.as:42-52.
   */
  integrate(): void {
    this.ox = this.x;
    this.oy = this.y;
    let deg = radToDeg(Math.atan2(this.yvel, this.xvel));
    if ((this.xvel < C.NO_ROTATE_XVEL && this.y > C.NO_ROTATE_Y) || !this.doRotation) deg = 0;
    // The art is authored pointing up, hence the quarter turn - also when
    // rotation is off, so the clip is never at 0.
    this.rotationDeg = deg + 90;
    // `bltClip._x += xvel` writes a clip property, so the position lands on
    // the twip grid - and `ox`/`oy`, read back from the clip, with it.
    this.x = toTwips(this.x + this.xvel);
    this.y = toTwips(this.y + this.yvel);
  }

  /**
   * `Bullet.increaseGravity(n)` - ignores its argument and always computes lift
   * proportional to horizontal speed. Called only from `onMouseDown`, so the
   * value is frozen for the duration of the hold.
   */
  setGlideGravity(): void {
    this.grav = C.GLIDE_FACTOR * this.xvel;
  }

  /** `Bullet.restoreGravity()`. */
  restoreGravity(): void {
    this.grav = C.GRAV;
  }
}

// Not ported: `Bullet.deleteBlt()`, whose entire body is the expression `false;`.
// Its emptiness is load-bearing - `onShotDone()` calls it (Game.as:957) and the
// projectile has to survive so the outcome clip can be placed at its position
// and `bc._x` can still be read for scoring. That lifetime rule is modelled by
// keeping the projectile alive until the turn ends, rather than by shipping a
// no-op method.
