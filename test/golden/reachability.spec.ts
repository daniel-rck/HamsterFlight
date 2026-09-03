import { describe, expect, it } from "vitest";
import { beginJump, stepJump } from "@/sim/phases/JumpPhase.ts";
import { attemptLaunch } from "@/sim/phases/Launch.ts";
import { mulberry32 } from "@/sim/rng/mulberry32.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";

/**
 * The pillow window follows from the hitboxes extracted out of the SWF, and it
 * turns out not every jump can reach it: with the weakest rolls the apex stays
 * short of the box entirely, making that turn an unavoidable faceplant.
 *
 * That is a measured consequence of the extracted geometry, not a decision. It
 * is pinned here because it is the most feel-critical number in the game, and
 * because the `core` placement is the one measurement still open to
 * calibration: `core` sits inside a multi-frame hamster sprite and this port
 * reads the placement from the frame the extractor encounters first. If the box
 * is ever recalibrated, this test says exactly what that did to playability.
 */
describe("pillow reachability", () => {
  it("pins the share of jumps that can reach the pillow", () => {
    let reachable = 0;
    const total = 1000;

    for (let seed = 1; seed <= total; seed++) {
      const rng = mulberry32(seed);
      const state = beginJump(rng);
      for (let t = 0; t < 80; t++) {
        if (stepJump(state, rng, [])) break;
        if (attemptLaunch(state, DEFAULT_TUNING).hit) {
          reachable++;
          break;
        }
      }
    }

    const share = reachable / total;
    // Measured at 68% with the extracted boxes. The band is wide enough not
    // to flap on a rounding change and narrow enough that a recalibration of
    // `core` - the one open measurement - shows up here first.
    expect(share).toBeGreaterThan(0.6);
    expect(share).toBeLessThan(0.76);
    console.info("[reachability] %d%% of jumps can reach the pillow", Math.round(share * 100));
  });
});
