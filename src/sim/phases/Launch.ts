import { C } from "../constants.ts";
import { overlaps } from "../math/aabb.ts";
import { PI_AS2, radToDeg } from "../math/angles.ts";
import type { JumpState } from "../state.ts";
import type { Tuning } from "../tuning.ts";

export interface LaunchResult {
  readonly hit: boolean;
  /** Launch speed - `90 - dist`, so nearness to the pillow centre. */
  readonly vel: number;
  readonly angleDeg: number;
  readonly angleRad: number;
  /** Position the projectile starts from, after the y clamp. */
  readonly y: number;
}

const MISS: LaunchResult = { hit: false, vel: 0, angleDeg: 0, angleRad: 0, y: 0 };

/**
 * `Game.launch()` + `getPillowCollision()` + `shoot()` - Game.as:1118-1183.
 *
 * Two things here are easy to get wrong and both matter:
 *
 *  - `vel = 90 - dist` means the launch speed is *nearness* to the pillow
 *    centre, not a charge meter. The maximum is 52, at dy = 0.
 *  - the y clamp at 759 also zeroes `yvel`, which kills the rising bonus. So a
 *    hit below 759 is doubly punished: no bonus, and an angle around 109
 *    degrees, i.e. aimed slightly downwards.
 */
export function attemptLaunch(jump: JumpState, tuning: Tuning): LaunchResult {
  // hamster.core.hitTest(pillow) - note the whole pillow clip, not pillow.core.
  const hits = overlaps(
    C.HAMSTER_X,
    jump.y,
    tuning.boxes.hamsterJumpCore,
    C.PILLOW_LAUNCH_X,
    C.PILLOW_Y,
    tuning.boxes.pillow,
  );
  if (!hits) return MISS;

  let y = jump.y;
  let yvel = jump.yvel;
  if (y > C.PILLOW_CLAMP_Y) {
    y = C.PILLOW_CLAMP_Y;
    yvel = 0;
  }

  const dx = C.HAMSTER_X - C.PILLOW_LAUNCH_X + C.LAUNCH_DX_BIAS;
  const dy = y - C.PILLOW_Y + C.LAUNCH_DY_BIAS;
  // Not Math.hypot: the original is sqrt(dx*dx + dy*dy) and the two are not
  // guaranteed bit-identical.
  const dist = Math.sqrt(dx * dx + dy * dy);

  // The original round-trips through degrees using its own pi, twice:
  //   ar = atan2(dy, dx); ad = ar * 180 / pi + 90; ar = ad * pi / 180
  // The conversions cancel exactly, leaving ar = atan2(dy, dx) + PI_AS2 / 2.
  const angleDeg = radToDeg(Math.atan2(dy, dx)) + 90;
  const angleRad = Math.atan2(dy, dx) + PI_AS2 / 2;

  let vel = C.LAUNCH_VEL_BASE - dist;
  // Bonus for connecting while still rising. yvel is negative here, so the
  // subtraction adds speed.
  if (yvel < 0) vel += angleDeg <= 90 ? -yvel / 2 : yvel / 2;

  return { hit: true, vel, angleDeg, angleRad, y };
}
