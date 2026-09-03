import type { SpriteMeta } from '@/assets/sprites.generated.ts';
import { poseFor } from '@/render/scene/pose.ts';
import type { SimSnapshot } from '@/sim/state.ts';

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
 * The last frame of `hamster/jump` the port will show.
 *
 * The clip is one timeline with four runs in it: five identical frames of the
 * hamster standing (frame 1, which is what `gotoAndStop(1)` holds), seven of
 * it pulling the goggles down, seven more holding that pose - and then a
 * crouch, a takeoff that lifts the art 100 px out of the box, a tumbling ball
 * and one blank frame.
 *
 * Only the first three runs keep the body on the registration point, which is
 * where the `core` that tests against the pillow is and therefore the only
 * place the hamster may be drawn while `jumpFrame()` is the thing moving it.
 * The takeoff frames animate a leap *away* from a clip that stands still, so
 * playing them on top of a clip the code is already lifting drew the hamster a
 * hundred px above its own hitbox and then snapped it back; the blank frame
 * blinked it out mid-jump. The run therefore ends on the held goggles pose -
 * the one the original itself repeats seven times - and stays there.
 */
const JUMP_RUN_LAST = 18;

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
   * plays once too, from the click and up to `JUMP_RUN_LAST`. The flight poses
   * loop, but from the anchor rather than from boot.
   *
   * Where the jump clip's `stop()` and its `"jump"` label actually sit is not
   * recoverable from the exported art - only the frame scripts would say, and
   * they are not in the manifest. What the art does say is which frames may be
   * drawn at all while the code owns the position, and that is what bounds the
   * run: a jump lasts 1.7-2.5 s and holds its last frame for the rest of it.
   */
  frame(s: SimSnapshot, meta: Pick<SpriteMeta, 'frames' | 'fps'>, nowMs: number): number {
    // The anchor is per *run*, not per pose: `ready` and `jumping` are the same
    // clip, so keying on the pose alone never restarted it and the click
    // dropped the hamster into whichever frame a clock started at boot had
    // reached - the tumbling ball, or the blank one. `gotoAndPlay("jump")`
    // (Game.as:1024) starts it from the top, and this is that.
    const run = `${poseFor(s)}:${s.phaseKind}`;
    if (run !== this.#run) {
      this.#run = run;
      this.#startedMs = nowMs;
    }
    if (meta.frames <= 1) return 0;
    if (s.phaseKind === 'ready') return 0;

    const step = clipStep(this.#startedMs, nowMs, meta.fps ?? FPS);
    if (s.phaseKind === 'settling') return Math.min(step, meta.frames - 1);
    if (s.phaseKind === 'jumping') return Math.min(step, JUMP_RUN_LAST, meta.frames - 1);
    return step % meta.frames;
  }

  /**
   * The frame for a second clip drawn under the same pose - the `hamster/fly`
   * that shows through the enhanced mode's `hamster/ball` bubble. It shares the
   * anchor, so the two never drift apart.
   */
  innerFrame(meta: Pick<SpriteMeta, 'frames' | 'fps'>, nowMs: number): number {
    if (meta.frames <= 1) return 0;
    return clipStep(this.#startedMs, nowMs, meta.fps ?? FPS) % meta.frames;
  }
}
