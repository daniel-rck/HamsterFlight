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
 * The rule, and the only state this needs, is one anchor: whenever the pose
 * changes, the clip restarts. The simulation is neither consulted nor touched -
 * the same rule `PreLaunchScene` follows.
 */

/** The original stage rate; every clip in the SWF animates on it. */
const FPS = 19;

/** How many frames a clip has advanced since its anchor. Never negative. */
export function clipStep(startedMs: number, nowMs: number, fps = FPS): number {
  return Math.max(0, Math.floor(((nowMs - startedMs) / 1000) * fps));
}

export class PoseClock {
  /** Null until the first frame, so the first pose seen sets the anchor. */
  #pose: string | null = null;
  #startedMs = 0;

  /** Drop the anchor - on a restart, or when the tab comes back. */
  clear(): void {
    this.#pose = null;
    this.#startedMs = 0;
  }

  /**
   * The frame to draw for this snapshot's pose.
   *
   * `ready` pins to frame 0 - `gotoAndStop(1)`, the hamster waiting on the pad.
   * The outcome clips play once and hold their last frame, because the original
   * attaches them for the length of the outcome and never loops them. Everything
   * else loops, but from the anchor rather than from boot: a jump now starts on
   * frame 0 at the moment of the click.
   *
   * Whether the 36-frame jump clip has a `stop()` on its last frame is not
   * recoverable from the exported art - only the frame scripts would say, and
   * they are not in the manifest. Looping is the assumption: a jump lasts
   * 1.7-2.5 s against the clip's 1.9 s, so a freeze would be visible on the
   * long ones.
   */
  frame(s: SimSnapshot, meta: Pick<SpriteMeta, 'frames' | 'fps'>, nowMs: number): number {
    const pose = poseFor(s);
    if (pose !== this.#pose) {
      this.#pose = pose;
      this.#startedMs = nowMs;
    }
    if (meta.frames <= 1) return 0;
    if (s.phaseKind === 'ready') return 0;

    const step = clipStep(this.#startedMs, nowMs, meta.fps ?? FPS);
    if (s.phaseKind === 'settling') return Math.min(step, meta.frames - 1);
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
