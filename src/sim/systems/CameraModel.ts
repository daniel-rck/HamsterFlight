import { C } from "../constants.ts";
import { toTwips } from "../math/twips.ts";
import type { CameraState } from "../state.ts";

/**
 * Port of `GameCamera.doFollow` / `zero` / `getCameraPos`
 * (reference/as2/GameCamera.as).
 *
 * This is simulation state, not presentation: `getCameraPos().x` feeds the
 * powerup spawn gate and spawn position, so the exact behaviour moves where
 * items appear. `CameraState` is the container's `_x`/`_y`, so every write
 * goes through `toTwips`.
 */

/** `GameCamera.zero()` - the camera starts at (0, -600), not at the origin. */
export function newCamera(): CameraState {
  return { x: 0, y: C.CAM_Y_CLAMP };
}

/**
 * `doFollow` - note the asymmetry, which is easy to miss and is load-bearing:
 *
 *   if (-targetX + 150 < 0) { _x = ... }     // x is assigned ONLY when negative
 *   if (-targetY + 200 > -600) { _y = ... } else { _y = -600 }
 *
 * So while the hamster is left of x = 150 the camera's x does not move at all.
 * It stays wherever `zero()` or the last pan left it, which keeps the spawn
 * gate stable over the whole launch area rather than creeping by a few pixels.
 */
export function follow(cam: CameraState, targetX: number, targetY: number): void {
  const x = -targetX + C.CAM_ANCHOR_X;
  if (x < 0) cam.x = toTwips(x);

  const y = -targetY + C.CAM_ANCHOR_Y;
  cam.y = y > C.CAM_Y_CLAMP ? toTwips(y) : C.CAM_Y_CLAMP;
}

/**
 * `doQuickPanTo` - each tick moves the camera by the remaining distance divided
 * by `qpan_time`, so it converges geometrically, and finishes once the distance
 * drops below 2. `reset()` sets `qpan_time = 2` and pans to (300, 800).
 *
 * The original accumulates the move in `cameraTargetX/Y`, plain `Number`s
 * seeded from the container by `quickPanTo()` (GameCamera.as:152-153), and
 * copies them to `_$mc._x/_y` each tick (GameCamera.as:184-187). So the pan
 * keeps full precision while the container, and the distance measured from
 * it, sit on the twip grid. `pan` is that accumulator, in the container's
 * sign - see `beginQuickPan`.
 *
 * Returns true once the pan has arrived.
 */
export function quickPanStep(
  cam: CameraState,
  pan: CameraState,
  targetX: number,
  targetY: number,
  panDivisor: number,
): boolean {
  const centreX = -(cam.x - C.VIEW_W / 2);
  const centreY = -(cam.y - C.VIEW_H / 2);
  const dx = centreX - targetX;
  const dy = centreY - targetY;
  const distance = Math.floor(Math.sqrt(dx * dx + dy * dy));

  pan.x += dx / panDivisor;
  pan.y += dy / panDivisor;
  cam.x = toTwips(pan.x);
  cam.y = toTwips(pan.y);

  if (distance < C.CAM_PAN_ARRIVE) {
    cam.x = toTwips(-targetX + C.VIEW_W / 2);
    cam.y = toTwips(-targetY + C.VIEW_H / 2);
    return true;
  }
  return false;
}

/** `quickPanTo()`'s `cameraTargetX = -_$mc._x` - the pan starts where the container is. */
export function beginQuickPan(cam: CameraState): CameraState {
  return { x: cam.x, y: cam.y };
}
