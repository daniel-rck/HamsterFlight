import { C } from '../constants.ts';
import type { CameraState } from '../state.ts';

/**
 * `GameCamera` is constructed as `new GameCamera(this._$mc, 600, 400)`
 * (Game.as:108) but its source is not in the decompilate, so the follow
 * behaviour is reconstructed from the offsets the rest of the code depends on:
 *
 *   _$mc._x = -targetX + 150
 *   _$mc._y = -targetY + 200,  clamped to >= -600
 *
 * `getCameraPos()` returns those negative container offsets, which is why they
 * show up as `camX` in the spawn formulas. Getting this wrong moves where
 * powerups appear, so it is simulation state, not presentation.
 */
export function follow(cam: CameraState, targetX: number, targetY: number): void {
  cam.x = -targetX + C.CAM_ANCHOR_X;
  cam.y = Math.max(-targetY + C.CAM_ANCHOR_Y, C.CAM_Y_CLAMP);
}

/**
 * A fresh camera already framing the launch pad. Not (0, 0): the world sits
 * between y = 700 and y = 950, so an unpositioned camera shows empty sky and
 * the player sees nothing before the first tick.
 */
export function newCamera(): CameraState {
  const cam: CameraState = { x: 0, y: 0 };
  follow(cam, C.HAMSTER_X, C.HAMSTER_START_Y);
  return cam;
}
