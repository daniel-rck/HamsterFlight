import { deepFreeze } from './freeze.ts';
import { HITBOXES } from './hitboxes.generated.ts';
import type { Box } from './math/aabb.ts';
import type { PowerupKind, ShotOutcome } from './types.ts';

/**
 * Everything the bytecode does NOT tell us. Kept separate from `constants.ts`
 * so the epistemic status of every number is visible: `C` is measured fact,
 * `Tuning` is calibratable guess. Injected into the simulation rather than
 * imported by the systems, so recalibration is a data change.
 */
export interface Tuning {
  readonly boxes: {
    readonly hamsterJumpCore: Box;
    readonly hamsterFlightCore: Box;
    readonly pillow: Box;
    readonly powerups: Readonly<Record<PowerupKind, Box>>;
  };
  /**
   * How many ticks a picked-up powerup keeps overlapping. Unknown: in the
   * original the pickup clip's own animation moves its `core` out of the way,
   * and those timelines are not recoverable from the constant table. Matters
   * because `speed` and `wind` are unguarded, so duration multiplies effect.
   */
  readonly powerupActiveTicks: Readonly<Record<PowerupKind, number>>;
  /**
   * The pan-back geometry is read from `GameCamera.as`, so only the safety cap
   * remains here: `settling` gives up waiting for `quickPanStep` to converge
   * after this many ticks, so the state machine can never soft-lock.
   */
  readonly camera: {
    readonly maxPanTicks: number;
  };
  /**
   * How long each outcome clip plays before its last frame calls
   * `setCamReset()`. The clip timelines are not in the constant table.
   */
  readonly outcomeHoldTicks: Readonly<Record<ShotOutcome, number>>;
  /**
   * `Bullet.increaseGravity` is called only from `onMouseDown` (Game.as:1040),
   * so the lift is frozen at `-0.17 * xvel` as measured at the press and does
   * NOT track the decaying xvel. `false` is the faithful behaviour; `true` is
   * the reading `sim.js` assumed - the lift is recomputed from the current
   * xvel on every held tick - kept switchable because it changes the optimal
   * strategy and the golden values.
   */
  readonly recomputeGlidePerTick: boolean;
}

export const DEFAULT_TUNING: Tuning = deepFreeze({
  boxes: {
    hamsterJumpCore: HITBOXES.hamsterJumpCore,
    hamsterFlightCore: HITBOXES.hamsterFlightCore,
    pillow: HITBOXES.pillow,
    powerups: {
      bounce: HITBOXES.powerupBounce,
      speed: HITBOXES.powerupSpeed,
      wind: HITBOXES.powerupWind,
      slide: HITBOXES.powerupSlide,
      rebound: HITBOXES.powerupRebound,
      superbounce: HITBOXES.powerupSuperbounce,
    },
  },
  // Guesses. `wind` is longer than the rest because its branch is the only one
  // that never calls `play()` on the pickup clip (Game.as:732-745), suggesting
  // its core lingers instead of animating away.
  powerupActiveTicks: {
    bounce: 1,
    speed: 1,
    wind: 3,
    slide: 1,
    rebound: 1,
    superbounce: 1,
  },
  camera: { maxPanTicks: 120 },
  outcomeHoldTicks: { cheer: 24, faceplant: 20, hole: 24, zero: 20 },
  recomputeGlidePerTick: false,
});
