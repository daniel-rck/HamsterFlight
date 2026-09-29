import { SPRITES, type SpriteId } from "@/assets/sprites.generated.ts";
import { C } from "@/sim/constants.ts";
import type { SimEvent } from "@/sim/events.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/**
 * Everything at the launcher end of the world: the tower, the operator
 * swinging the pillow, the two hamster wheels, the queue of hamsters waiting
 * their turn, and the launch meter that reads the jump.
 *
 * None of it is an addition. The original drew all of it and this port drew
 * none of it, so it is not an effect to gate - the same reasoning that keeps
 * the `fx/*` impact clips out of the `motion` gate.
 *
 * The simulation is not consulted and not touched: every frame number here is
 * derived from the snapshot and the event stream, which is the rule
 * `porting-notes.md` already sets for clouds and bushes.
 */

/** The original stage rate. Every clip in the SWF animates on it. */
const FPS = 19;

/**
 * `background_mc` follows the game clip in x but sits 600 px lower in y:
 * `zero()` parks the game clip at -600, and `doFollow` keeps
 * `background_mc._y = game._y + 600`. GameCamera.as:51-53, 82-92. So a point at
 * (bx, by) in the backdrop is at (bx, by + 600) in the game clip's own space,
 * which is the space this renderer draws in.
 *
 * The original also stops scrolling the backdrop once the camera passes 650 px,
 * freezing the launcher where it is. The port lets it scroll away with the rest
 * of the world instead - by then it is off the left edge either way, and an
 * endlessly scrolling ground has no hills clip to stay glued to.
 */
const BACKDROP_Y = -C.CAM_Y_CLAMP;

/**
 * `background_mc`'s timeline, read from the frame scripts of clip 145.
 *
 *    1  stop            the idle pose; frames 2 and 3 are the same picture
 *    4  stop            the wind-up, held from the first click
 *    5  play            the swing, through to
 *    7  gotoAndStop(1)  and back to idle
 *   10  ("miss")        the whiff, through to
 *   49  gotoAndStop(1)  and back to idle
 *
 * Frames 8 and 9 are never shown: `getPillowCollision` jumps straight to the
 * "miss" label in the same click that reached frame 5.
 */
const SWING_IDLE = 0;
const SWING_WIND = 3;
const SWING_HIT = [4, 6] as const;
const SWING_MISS = [9, 48] as const;

/** `reset()` parks the four waiting hamsters 15 px apart. Game.as:366-377. */
const QUEUE_X = [30.5, 15.5, 0.5, -14.5] as const;
const QUEUE_Y = 920.8;
/** Frame 26 of the clip runs `_x += 15` and stops - exactly one slot up. */
const QUEUE_STEP = 15;
/** `gotoAndPlay("walkUp")`; the label sits on frame 20, the `_x += 15` on 26. */
const WALK_UP = [19, 25] as const;
/** The one whose turn it is walks out instead, and hides itself at frame 15. */
const WALK_OUT = [0, 14] as const;

/**
 * Where a run started by `nextHamster()` is, from the simulation's walk-out
 * counter rather than a clock of its own - the way `windupFrame` drives the
 * jump - so the walker reaching the pad and the pad hamster appearing are the
 * same tick, and there is never a frame with both or neither. -1 once the run
 * is over, or when nothing is walking.
 */
function walkFrame(walkOut: number | null, run: readonly [number, number]): number {
  if (walkOut === null) return -1;
  const frame = run[0] + Math.floor((walkOut * C.TICK_MS * FPS) / 1000);
  return frame > run[1] ? -1 : frame;
}

export interface Placement {
  readonly sprite: SpriteId;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

export interface PreLaunchLayout {
  /**
   * World space, back to front. The original's stage-space art here - the
   * launch dial and the five shot pips - is drawn by the port's HUD bar from
   * the same state instead (`scene/hud.ts`).
   */
  readonly world: readonly Placement[];
}

/**
 * Which frame of a run is showing, or -1 once it has finished. Frames are
 * inclusive on both ends, as the SWF's labels are.
 */
function frameAt(startedMs: number, nowMs: number, run: readonly [number, number]): number {
  const step = Math.floor(((nowMs - startedMs) / 1000) * FPS);
  if (step < 0) return -1;
  const frame = run[0] + step;
  return frame > run[1] ? -1 : frame;
}

function loopFrame(sprite: SpriteId, nowMs: number): number {
  const frames = SPRITES[sprite].frames;
  return Math.floor((nowMs / 1000) * FPS) % frames;
}

export class PreLaunchScene {
  /** When the current swing run began; which one it is lives in `#swing`. */
  #swingStartedMs = 0;
  #swing: "idle" | "hit" | "miss" = "idle";

  /**
   * Takes one tick's events. Only the two launch outcomes matter here: they
   * are the difference between the three-frame swing and the forty-frame
   * whiff, and nothing in the snapshot distinguishes them.
   */
  consume(events: readonly SimEvent[], nowMs: number): void {
    for (const event of events) {
      if (event.t === "launched" || event.t === "missed") {
        this.#swing = event.t === "launched" ? "hit" : "miss";
        this.#swingStartedMs = nowMs;
      }
    }
  }

  /** Drop everything in flight - on a restart, or when the tab comes back. */
  clear(): void {
    this.#swing = "idle";
  }

  layout(s: SimSnapshot, nowMs: number): PreLaunchLayout {
    return {
      world: [...this.#launcher(s, nowMs), ...this.#queue(s)],
    };
  }

  // -- world ---------------------------------------------------------------

  #launcher(s: SimSnapshot, nowMs: number): Placement[] {
    const spinning = s.phaseKind === "jumping";
    return [
      { sprite: "launcher/swing", frame: this.#swingFrame(s, nowMs), x: 0, y: BACKDROP_Y },
      { sprite: "launcher/frame", frame: 0, x: 0, y: BACKDROP_Y },
      {
        sprite: "launcher/wheel1",
        frame: spinning ? loopFrame("launcher/wheel1", nowMs) : 0,
        x: 0,
        y: BACKDROP_Y,
      },
      {
        sprite: "launcher/wheel2",
        frame: spinning ? loopFrame("launcher/wheel2", nowMs) : 0,
        x: 0,
        y: BACKDROP_Y,
      },
    ];
  }

  #swingFrame(s: SimSnapshot, nowMs: number): number {
    if (this.#swing !== "idle") {
      const run = this.#swing === "hit" ? SWING_HIT : SWING_MISS;
      const frame = frameAt(this.#swingStartedMs, nowMs, run);
      if (frame >= 0) return frame;
      this.#swing = "idle";
    }
    // A miss leaves the hamster still bobbing, so the wind-up pose comes back
    // as soon as the whiff has played out.
    return s.phaseKind === "jumping" ? SWING_WIND : SWING_IDLE;
  }

  /**
   * `nextHamster()` walks the next one out and shuffles the rest one slot up
   * in the same call (Game.as:984-1004), when the turn changes - which is when
   * the simulation starts `walkOut`. Before, the queue ran on a clock of its
   * own from the first snapshot showing the new turn, and the pad hamster was
   * already standing there: two hamsters at the launcher for the whole walk.
   */
  #queue(s: SimSnapshot): Placement[] {
    const out: Placement[] = [];
    const walkUp = walkFrame(s.walkOut, WALK_UP);
    const walkingOut = walkFrame(s.walkOut, WALK_OUT);
    const shuffling = walkUp >= 0;

    for (const [at, base] of QUEUE_X.entries()) {
      // `hWalkOut2` through `hWalkOut5`: the one at index 0 is next up.
      const member = at + 2;
      // Each shuffle moves a clip one slot, so after `turn - 1` of them it has
      // travelled `15 * (turn - 1)` towards the launcher.
      const shuffles = s.turn - 1;

      if (member === s.turn) {
        // This one is walking out to the launcher. It hides itself at frame 15,
        // where the pad hamster takes over, and does not come back until the
        // next game.
        if (walkingOut >= 0) {
          out.push({
            sprite: "queue/hamster",
            frame: walkingOut,
            x: base + QUEUE_STEP * (shuffles - 1),
            y: QUEUE_Y,
          });
        }
        continue;
      }
      if (member < s.turn) continue;

      if (shuffling) {
        // Mid-shuffle it is still standing in its old slot; the `_x += 15` on
        // frame 26 is what moves it, so the step and the move are not
        // simultaneous. That mismatch is the original's, not a rounding error.
        out.push({
          sprite: "queue/hamster",
          frame: walkUp,
          x: base + QUEUE_STEP * (shuffles - 1),
          y: QUEUE_Y,
        });
      } else {
        out.push({
          sprite: "queue/hamster",
          frame: 0,
          x: base + QUEUE_STEP * shuffles,
          y: QUEUE_Y,
        });
      }
    }
    return out;
  }
}
