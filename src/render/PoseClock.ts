import type { SpriteMeta } from "@/assets/sprites.generated.ts";
import { poseFor } from "@/render/scene/pose.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/**
 * Which frame of the hamster's own clip is showing.
 *
 * The decoration clips - wheels, powerups, the `fx/*` impacts - are true loops
 * and `animFrame` indexes them straight off a free-running clock. The hamster
 * is not: the original holds it on frame 1 until the click
 * (`reset()` - Game.as:365-366), starts the clip with `gotoAndPlay("jump")` on
 * the first `onMouseDown` (Game.as:1021-1027), and each outcome clip is
 * attached fresh when the shot ends, so it plays from its own frame 1.
 *
 * Reading a wall clock instead left the jump animating before anyone had
 * pressed anything, and made every jump and every outcome start at whichever
 * frame the clock happened to be on.
 *
 * The rule, and the only state this needs, is one anchor: whenever the *run*
 * changes - the pose, or the phase it is being shown in - the clip restarts.
 * The simulation is neither consulted nor touched - the same rule
 * `PreLaunchScene` follows.
 */

/** The original stage rate; every clip in the SWF animates on it. */
const FPS = 19;

/**
 * `hamster/jump` is clip 52 played the way its own frame scripts play it
 * (as2/timeline/DefineSprite_52): label `jump` on frame 2, the wind-up on the
 * pad through frame 27, and frame 28 lifts the clip, calls `jump()` and
 * `stop()`s. The clip then holds frame 28, where the tumbling ball is a
 * nested clip (51) that loops its four frames - `gotoAndPlay(1)` on its
 * frame 4 - on its own. ffdec flattens that nesting into frames 28-35, so the
 * loop is indices 27-30 of the export, and nothing past them is ever shown.
 */
const JUMP_BALL_FIRST = 27;
const JUMP_BALL_FRAMES = 4;

/**
 * The wind-up frame for a tick count, 0-based: frame 2 at the click, then the
 * stage rate. Driven by the simulation's tick rather than the wall clock, so
 * the art and the frame-28 lift - which the simulation performs - cannot drift
 * apart and draw the leap twice.
 */
export function windupFrame(windup: number): number {
  return Math.min(JUMP_BALL_FIRST - 1, 1 + Math.floor((windup * C.TICK_MS * FPS) / 1000));
}

/** How many frames a clip has advanced since its anchor. Never negative. */
export function clipStep(startedMs: number, nowMs: number, fps = FPS): number {
  return Math.max(0, Math.floor(((nowMs - startedMs) / 1000) * fps));
}

export class PoseClock {
  /** Null until the first frame, so the first run seen sets the anchor. */
  #run: string | null = null;
  #startedMs = 0;

  /** Drop the anchor - on a restart, or when the tab comes back. */
  clear(): void {
    this.#run = null;
    this.#startedMs = 0;
  }

  /**
   * The frame to draw for this snapshot's pose.
   *
   * `ready` pins to frame 0 - `gotoAndStop(1)`, the hamster waiting on the pad.
   * The outcome clips play once and hold their last frame, because the original
   * attaches them for the length of the outcome and never loops them. The jump
   * follows the simulation's wind-up and then loops the ball. The flight poses
   * loop, but from the anchor rather than from boot. The ball re-anchors at
   * the lift, which is where clip 51 starts.
   */
  frame(s: SimSnapshot, meta: Pick<SpriteMeta, "frames" | "fps">, nowMs: number): number {
    // The anchor is per *run*, not per pose: `ready` and `jumping` are the same
    // clip, so keying on the pose alone never restarted it and the click
    // dropped the hamster into whichever frame a clock started at boot had
    // reached - the tumbling ball, or the blank one. `gotoAndPlay("jump")`
    // (Game.as:1024) starts it from the top, and this is that.
    const airborne = s.phaseKind === "jumping" && s.windup === null;
    const run = `${poseFor(s)}:${s.phaseKind}${airborne ? ":air" : ""}`;
    if (run !== this.#run) {
      this.#run = run;
      this.#startedMs = nowMs;
    }
    if (meta.frames <= 1) return 0;
    if (s.phaseKind === "ready") return 0;

    const step = clipStep(this.#startedMs, nowMs, meta.fps ?? FPS);
    if (s.phaseKind === "settling") return Math.min(step, meta.frames - 1);
    if (s.phaseKind === "jumping") {
      if (s.windup !== null) return Math.min(windupFrame(s.windup), meta.frames - 1);
      return Math.min(JUMP_BALL_FIRST + (step % JUMP_BALL_FRAMES), meta.frames - 1);
    }
    return step % meta.frames;
  }

  /**
   * The frame for a second clip drawn under the same pose - the `hamster/fly`
   * that shows through the enhanced mode's `hamster/ball` bubble. It shares the
   * anchor, so the two never drift apart.
   */
  innerFrame(meta: Pick<SpriteMeta, "frames" | "fps">, nowMs: number): number {
    if (meta.frames <= 1) return 0;
    return clipStep(this.#startedMs, nowMs, meta.fps ?? FPS) % meta.frames;
  }
}
