import { SPRITES, type SpriteId } from '@/assets/sprites.generated.ts';
import { C } from '@/sim/constants.ts';
import type { SimEvent } from '@/sim/events.ts';
import { launchMeterValue } from '@/sim/phases/JumpPhase.ts';
import type { Phase, SimSnapshot } from '@/sim/state.ts';

/**
 * Everything at the launcher end of the world: the tower, the operator
 * swinging the pillow, the two hamster wheels, the queue of hamsters waiting
 * their turn, and the launch meter that reads the jump.
 *
 * None of it is an addition. The original drew all of it and this port drew
 * none of it, so it is on in both modes - the same reasoning that keeps the
 * `fx/*` impact clips out of the enhanced gate.
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

/** `_root.launchMeter`, placed on the main timeline at (78.05, 3). */
const METER_X = 78.05;
const METER_Y = 3;
/** `arrow._x` is never written, so the needle keeps its placement inside. */
const NEEDLE_X = 15;
/** The five `shotStatusN_mc`, likewise straight off the main timeline. */
const PIP_X = [16.05, 16.2, 16.2, 16.2, 16.2] as const;
const PIP_Y = [10.35, 30.3, 50.25, 70.2, 90.15] as const;
/** Frame 1 is labelled `off`, frame 2 `on`. */
const PIP_OFF = 0;
const PIP_ON = 1;

export interface Placement {
  readonly sprite: SpriteId;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

export interface Needle extends Placement {
  /** `arrow._rotation = 180` while the hamster is on the way down. */
  readonly flipped: boolean;
}

export interface PreLaunchLayout {
  /** World space, back to front. */
  readonly world: readonly Placement[];
  /** Stage space: the dial when it is up, then the five shot pips. */
  readonly hud: readonly Placement[];
  /** Stage space, drawn over the dial. Null whenever the dial is down. */
  readonly needle: Needle | null;
}

/**
 * True once `launch()` has fired.
 *
 * The original arms the launcher on the first click (`state = "jump"`) but only
 * swings on the second, and it is that second click that moves the pillow to
 * `PILLOW_LAUNCH_X`. Game.as:1016-1037, 1118-1121. It stays there for the whole
 * flight and is put back by `onDone()` once the camera has panned home.
 * Game.as:979-980.
 */
export function launched(phase: Phase['kind']): boolean {
  return phase === 'flying' || phase === 'settling';
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
  #swing: 'idle' | 'hit' | 'miss' = 'idle';
  /** When the queue last shuffled, and which turn it shuffled into. */
  #shuffleStartedMs = Number.NEGATIVE_INFINITY;
  /** Null until the first snapshot, so nothing animates on the way in. */
  #turn: number | null = null;

  /**
   * Takes one tick's events. Only the two launch outcomes matter here: they
   * are the difference between the three-frame swing and the forty-frame
   * whiff, and nothing in the snapshot distinguishes them.
   */
  consume(events: readonly SimEvent[], nowMs: number): void {
    for (const event of events) {
      if (event.t === 'launched' || event.t === 'missed') {
        this.#swing = event.t === 'launched' ? 'hit' : 'miss';
        this.#swingStartedMs = nowMs;
      }
    }
  }

  /** Drop everything in flight - on a restart, or when the tab comes back. */
  clear(): void {
    this.#swing = 'idle';
    this.#shuffleStartedMs = Number.NEGATIVE_INFINITY;
    this.#turn = null;
  }

  layout(s: SimSnapshot, nowMs: number): PreLaunchLayout {
    // The queue shuffles when the turn changes, not on `turnStart` - that cue
    // fires on the first click of the new turn, and the original had already
    // shuffled by then. `nextHamster()` runs from `updateGameState()`, which is
    // the same moment `turn` increments here. Game.as:396-405, 984-1004.
    // A drop - a restart - is adopted silently, and so is the first snapshot
    // after `clear()`: the tab coming back should not replay a shuffle that
    // happened while it was hidden.
    if (s.turn !== this.#turn) {
      const advanced = this.#turn !== null && s.turn > this.#turn;
      this.#shuffleStartedMs = advanced ? nowMs : Number.NEGATIVE_INFINITY;
      this.#turn = s.turn;
    }

    return {
      world: [...this.#launcher(s, nowMs), ...this.#queue(s, nowMs)],
      hud: this.#hud(s),
      needle: this.#needle(s),
    };
  }

  // -- world ---------------------------------------------------------------

  #launcher(s: SimSnapshot, nowMs: number): Placement[] {
    const spinning = s.phaseKind === 'jumping';
    return [
      { sprite: 'launcher/swing', frame: this.#swingFrame(s, nowMs), x: 0, y: BACKDROP_Y },
      { sprite: 'launcher/frame', frame: 0, x: 0, y: BACKDROP_Y },
      {
        sprite: 'launcher/wheel1',
        frame: spinning ? loopFrame('launcher/wheel1', nowMs) : 0,
        x: 0,
        y: BACKDROP_Y,
      },
      {
        sprite: 'launcher/wheel2',
        frame: spinning ? loopFrame('launcher/wheel2', nowMs) : 0,
        x: 0,
        y: BACKDROP_Y,
      },
    ];
  }

  #swingFrame(s: SimSnapshot, nowMs: number): number {
    if (this.#swing !== 'idle') {
      const run = this.#swing === 'hit' ? SWING_HIT : SWING_MISS;
      const frame = frameAt(this.#swingStartedMs, nowMs, run);
      if (frame >= 0) return frame;
      this.#swing = 'idle';
    }
    // A miss leaves the hamster still bobbing, so the wind-up pose comes back
    // as soon as the whiff has played out.
    return s.phaseKind === 'jumping' ? SWING_WIND : SWING_IDLE;
  }

  #queue(s: SimSnapshot, nowMs: number): Placement[] {
    const out: Placement[] = [];
    const shuffling = frameAt(this.#shuffleStartedMs, nowMs, WALK_UP) >= 0;
    const walkingOut = frameAt(this.#shuffleStartedMs, nowMs, WALK_OUT);

    for (const [at, base] of QUEUE_X.entries()) {
      // `hWalkOut2` through `hWalkOut5`: the one at index 0 is next up.
      const member = at + 2;
      // Each shuffle moves a clip one slot, so after `turn - 1` of them it has
      // travelled `15 * (turn - 1)` towards the launcher.
      const shuffles = s.turn - 1;

      if (member === s.turn) {
        // This one is walking out to the launcher. It hides itself at frame 15
        // and does not come back until the next game.
        if (walkingOut >= 0) {
          out.push({
            sprite: 'queue/hamster',
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
          sprite: 'queue/hamster',
          frame: frameAt(this.#shuffleStartedMs, nowMs, WALK_UP),
          x: base + QUEUE_STEP * (shuffles - 1),
          y: QUEUE_Y,
        });
      } else {
        out.push({
          sprite: 'queue/hamster',
          frame: 0,
          x: base + QUEUE_STEP * shuffles,
          y: QUEUE_Y,
        });
      }
    }
    return out;
  }

  // -- stage ---------------------------------------------------------------

  /**
   * The meter is up from `init()` and every `nextHamster()` until `shoot()`
   * takes it down. Game.as:154, 340, 992, 1157 - so it is up for exactly the
   * two phases before the hamster is in the air.
   */
  #meterUp(s: SimSnapshot): boolean {
    return s.phaseKind === 'ready' || s.phaseKind === 'jumping';
  }

  #hud(s: SimSnapshot): Placement[] {
    const out: Placement[] = [];
    if (this.#meterUp(s)) {
      out.push({ sprite: 'hud/launchMeter', frame: 0, x: METER_X, y: METER_Y });
    }
    for (const [at, y] of PIP_Y.entries()) {
      out.push({
        sprite: 'hud/shotPip',
        // `setScore()` lights the pip for the turn that just finished, so the
        // lit count is exactly the number of shots on the board.
        frame: at < s.shots.length ? PIP_ON : PIP_OFF,
        x: PIP_X[at] ?? PIP_X[0] ?? 0,
        y,
      });
    }
    return out;
  }

  #needle(s: SimSnapshot): Needle | null {
    if (!this.#meterUp(s)) return null;
    return {
      sprite: 'hud/launchArrow',
      frame: 0,
      x: METER_X + NEEDLE_X,
      y: METER_Y + launchMeterValue(s.hamster.y),
      flipped: s.hamster.yvel > 0,
    };
  }
}
