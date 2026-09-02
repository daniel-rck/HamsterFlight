import { C } from "../constants.ts";

/**
 * The hamster in flight - a direct port of `reference/as2/Bullet.as` with the
 * display side (clip, shadow, rotation) removed.
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
  /** Display-only, but toggled by slide/skid, so it travels in the snapshot. */
  doRotation = true;

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
  }

  /** `Bullet.update()` - order matters, ox/oy are captured before the move. */
  integrate(): void {
    this.ox = this.x;
    this.oy = this.y;
    this.x += this.xvel;
    this.y += this.yvel;
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
