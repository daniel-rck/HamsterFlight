import { describe, expect, it } from "vitest";
import { beginJump, stepJump } from "@/sim/phases/JumpPhase.ts";
import { attemptLaunch } from "@/sim/phases/Launch.ts";
import { mulberry32 } from "@/sim/rng/mulberry32.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";

/**
 * The pillow window follows from the hitboxes extracted out of the SWF. With
 * the physics starting from the pad this came out at 68%: a third of the rolls
 * peaked short of the box, an unavoidable faceplant. That was the port's
 * mistake, not the original's - clip 52 lifts itself 117.8 px before it calls
 * `jump()` (as2/timeline/DefineSprite_52/frame_28), and from there every roll
 * clears the window.
 *
 * Pinned because it is the most feel-critical number in the game, and because
 * `core` placement is the measurement most open to calibration: if the box is
 * ever recalibrated, this test says exactly what that did to playability.
 */
describe("pillow reachability", () => {
  it("lets every jump reach the pillow", () => {
    let reachable = 0;
    const total = 1000;

    for (let seed = 1; seed <= total; seed++) {
      const rng = mulberry32(seed);
      const state = beginJump();
      for (let t = 0; t < 120; t++) {
        if (stepJump(state, rng, [])) break;
        if (attemptLaunch(state, DEFAULT_TUNING).hit) {
          reachable++;
          break;
        }
      }
    }

    expect(reachable).toBe(total);
    console.info("[reachability] %d%% of jumps can reach the pillow", (reachable / total) * 100);
  });

  it("never lets a swing during the wind-up connect", () => {
    // No `core` before clip 52's frame 28.
    const state = beginJump();
    const rng = mulberry32(1);
    while (state.windup !== null) {
      expect(attemptLaunch(state, DEFAULT_TUNING).hit).toBe(false);
      stepJump(state, rng, []);
    }
  });
});
