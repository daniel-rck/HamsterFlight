import { C } from "../constants.ts";
import type { SimEvent } from "../events.ts";
import { toTwips } from "../math/twips.ts";
import type { Rng } from "../rng/Rng.ts";
import type { JumpState } from "../state.ts";

/** Frames of a clip timeline, in whole ticks - the first tick at or after them. */
export function framesToTicks(frames: number): number {
  return Math.ceil((frames * 1000) / C.STAGE_FPS / C.TICK_MS);
}

/** The tick the wind-up ends on - clip 52's frame 28. */
export const JUMP_WINDUP_TICKS = framesToTicks(C.JUMP_WINDUP_FRAMES);
/** The tick `snd_jump` starts on - clip 52's frame 23. */
export const JUMP_SFX_TICK = framesToTicks(C.JUMP_SFX_FRAMES);

/**
 * The click: `hamster.gotoAndPlay("jump")` - Game.as:1024. The hamster stays on
 * the pad for the wind-up; `stepJump` plays it out and then does what the
 * clip's frame 28 does.
 */
export function beginJump(): JumpState {
  return { windup: 0, y: C.HAMSTER_START_Y, yvel: 0, boost: false, swung: false };
}

/**
 * Clip 52's frame 28 script: `this._y -= 117.8; hamsterShoot.jump()`, and
 * `Game.jump()` - Game.as:1063-1071.
 */
export function liftOff(s: JumpState, rng: Rng): void {
  s.windup = null;
  s.y = toTwips(s.y - C.JUMP_CLIP_LIFT);
  s.yvel = (rng.int(C.JUMP_YVEL_RAND) + C.JUMP_YVEL_BASE) * -1;
}

/**
 * One 50 ms tick of the jump: the wind-up on the pad, then
 * `Game.jumpFrame()` - Game.as:1072-1117.
 *
 * `jump()` starts the interval, so the first `jumpFrame()` runs a tick after
 * the lift, not on it.
 *
 * Returns true when the hamster has landed back on the pad, i.e. the pillow
 * never connected. `Simulation` hands the turn back rather than scoring it.
 */
export function stepJump(s: JumpState, rng: Rng, out: SimEvent[]): boolean {
  if (s.windup !== null) {
    s.windup++;
    if (s.windup === JUMP_SFX_TICK) out.push({ t: "sfx", id: "jump", gain: C.SFX_VOLUME });
    if (s.windup >= JUMP_WINDUP_TICKS) liftOff(s, rng);
    return false;
  }

  // The one-shot boost is tested against the position *before* this tick's
  // move, and applied before gravity. From 838.2 that is the first tick.
  if (!s.boost && s.y < C.JUMP_BOOST_Y) {
    s.yvel += -(rng.int(C.JUMP_BOOST_RAND) + C.JUMP_BOOST_BASE);
    s.boost = true;
  }

  // Asymmetric gravity: the fall is slower than the climb, which widens the
  // hit window at the top of the arc.
  s.yvel += s.yvel < 0 ? C.JUMP_GRAV_RISING : C.JUMP_GRAV_FALLING;
  // `hamster._y` is a clip property. The jump moves in quarter pixels, so
  // this never actually changes a value; it keeps the rule in one shape.
  s.y = toTwips(s.y + s.yvel);

  if (s.y >= C.HAMSTER_START_Y) {
    s.y = C.HAMSTER_START_Y;
    out.push({ t: "sfx", id: "hit", gain: C.SFX_VOLUME });
    return true;
  }
  return false;
}

/**
 * The launch meter arrow position - `48 + 0.35417 * (y - 715)`, clamped to
 * 10..100 (Game.as:1105-1114). Presentation, but derived from sim state, so it
 * lives here where it can be tested.
 */
export function launchMeterValue(y: number): number {
  const v = 48 + 0.35417 * (y - 715);
  if (v > 100) return 100;
  if (v < 10) return 10;
  return v;
}
