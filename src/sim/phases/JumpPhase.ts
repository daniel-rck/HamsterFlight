import { C } from '../constants.ts';
import type { SimEvent } from '../events.ts';
import type { Rng } from '../rng/Rng.ts';
import type { JumpState } from '../state.ts';

/** `Game.jump()` - Game.as:1063-1071. */
export function beginJump(rng: Rng): JumpState {
  return {
    y: C.HAMSTER_START_Y,
    yvel: (rng.int(C.JUMP_YVEL_RAND) + C.JUMP_YVEL_BASE) * -1,
    boost: false,
    swung: false,
  };
}

/**
 * `Game.jumpFrame()` - Game.as:1072-1117. One 50 ms tick.
 *
 * Returns true when the hamster has landed back on the pad, i.e. the pillow
 * never connected. `Simulation` hands the turn back rather than scoring it.
 */
export function stepJump(s: JumpState, rng: Rng, out: SimEvent[]): boolean {
  // The one-shot boost is tested against the position *before* this tick's
  // move, and applied before gravity.
  if (!s.boost && s.y < C.JUMP_BOOST_Y) {
    s.yvel += -(rng.int(C.JUMP_BOOST_RAND) + C.JUMP_BOOST_BASE);
    s.boost = true;
  }

  // Asymmetric gravity: the fall is slower than the climb, which widens the
  // hit window at the top of the arc.
  s.yvel += s.yvel < 0 ? C.JUMP_GRAV_RISING : C.JUMP_GRAV_FALLING;
  s.y += s.yvel;

  if (s.y >= C.HAMSTER_START_Y) {
    s.y = C.HAMSTER_START_Y;
    out.push({ t: 'sfx', id: 'hit', gain: C.SFX_VOLUME });
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
