import type { PowerupKind, ShotOutcome } from "./types.ts";

/**
 * Everything the original did inline via `playSound(...)`, `gotoAndPlay(...)`
 * and `_root.x.text = ...` comes out of the simulation as data instead. That is
 * what keeps `src/sim` headless, and it lets tests assert on the cue stream as
 * well as the trajectory - so "physics still right, sound moved" can show up
 * as a failure. The golden specs check physics only; cues are pinned by the
 * hand-written specs in `test/sim/`.
 */
export type SoundId =
  | "shoot"
  | "fly"
  | "wind"
  | "bounce"
  | "superbounce"
  | "hit"
  | "pickup"
  | "bump"
  | "slide"
  | "skid"
  | "jump"
  | "prelude"
  | "theme"
  | "ending"
  // Started by clip timelines rather than by `Game` - see `as2/timeline/`.
  | "tumble"
  | "wheel"
  | "cheer"
  | "hole"
  | "fanfare"
  | "rebound"
  | "speed";

export type FxId = "bounceFx" | "break" | "superBreak";

export type SimEvent =
  | {
      readonly t: "sfx";
      readonly id: SoundId;
      readonly gain?: number;
      readonly loop?: boolean;
      /**
       * Stage frames (19 fps) after this tick. The timeline sounds are started
       * by a clip's frame N, and the clip is often attached on this tick -
       * `hit_cheer`'s cheer is frame 5, its caption tick frame 27.
       */
      readonly delayFrames?: number;
    }
  /**
   * `fade` marks the original's `fadeOutSound(s)` (Game.as:280-284, 315-323:
   * volume -3 every 50 ms, then `stop()`) as opposed to an immediate `stop()`.
   */
  | { readonly t: "sfxStop"; readonly id: SoundId; readonly fade?: true }
  /**
   * `Sound.setVolume` on a sound already playing. The original re-sets the
   * flight loop's volume from the speed every tick (Game.as:589-592) and the
   * slide loop's from `|xvel|` (Game.as:569-572), so this fires often.
   */
  | { readonly t: "sfxGain"; readonly id: SoundId; readonly gain: number }
  | { readonly t: "fx"; readonly id: FxId; readonly x: number; readonly y: number }
  | { readonly t: "pickup"; readonly kind: PowerupKind }
  | { readonly t: "launched"; readonly vel: number; readonly angleDeg: number }
  | { readonly t: "missed" }
  /**
   * The hamster came back down without the pillow ever connecting. The
   * original spent the turn here; this port hands the turn back instead -
   * see `Simulation.step`.
   */
  | { readonly t: "jumpFailed" }
  | { readonly t: "glide"; readonly on: boolean }
  | { readonly t: "falling"; readonly on: boolean }
  | { readonly t: "shotDone"; readonly feet: number; readonly outcome: ShotOutcome }
  | { readonly t: "turnStart"; readonly turn: number }
  | { readonly t: "gameOver"; readonly total: number; readonly shots: readonly number[] };
