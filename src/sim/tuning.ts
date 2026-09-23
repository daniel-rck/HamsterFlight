import { deepFreeze } from "./freeze.ts";
import { HITBOXES } from "./hitboxes.generated.ts";
import type { Box } from "./math/aabb.ts";
import type { PowerupKind } from "./types.ts";

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
   * How many ticks a picked-up powerup keeps firing. Its `play()` sends the
   * clip to frame 2, which removes the `core` (display-lists.txt, sprites
   * 454-466) - on the next stage frame, which at 19 fps against a 50 ms
   * interval is nearly always before the next tick. Only matters for the
   * unguarded `speed`; `wind` keeps its core and is bounded by the overlap
   * alone (`PowerupSpec.coreStays`), so its entry is unused.
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
  powerupActiveTicks: {
    bounce: 1,
    speed: 1,
    wind: 1,
    slide: 1,
    rebound: 1,
    superbounce: 1,
  },
  camera: { maxPanTicks: 120 },
  recomputeGlidePerTick: false,
});
