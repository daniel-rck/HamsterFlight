import type { PowerupKind, ShotOutcome } from './types.ts';

/**
 * Everything the original did inline via `playSound(...)`, `gotoAndPlay(...)`
 * and `_root.x.text = ...` comes out of the simulation as data instead. That is
 * what keeps `src/sim` headless, and it lets the golden tests assert on the cue
 * stream as well as the trajectory - so "physics still right, sound moved"
 * shows up as a failure.
 */
export type SoundId =
  | 'shoot'
  | 'fly'
  | 'wind'
  | 'bounce'
  | 'superbounce'
  | 'hit'
  | 'pickup'
  | 'bump'
  | 'slide'
  | 'skid'
  | 'jump'
  | 'prelude'
  | 'theme'
  | 'ending';

export type FxId = 'bounceFx' | 'break' | 'superBreak';

export type SimEvent =
  | { readonly t: 'sfx'; readonly id: SoundId; readonly gain?: number; readonly loop?: boolean }
  | { readonly t: 'sfxStop'; readonly id: SoundId }
  /**
   * `Sound.setVolume` on a sound already playing. The original re-sets the
   * flight loop's volume from the speed every tick (Game.as:589-592) and the
   * slide loop's from `|xvel|` (Game.as:569-572), so this fires often.
   */
  | { readonly t: 'sfxGain'; readonly id: SoundId; readonly gain: number }
  | { readonly t: 'fx'; readonly id: FxId; readonly x: number; readonly y: number }
  | { readonly t: 'pickup'; readonly kind: PowerupKind }
  | { readonly t: 'launched'; readonly vel: number; readonly angleDeg: number }
  | { readonly t: 'missed' }
  | { readonly t: 'glide'; readonly on: boolean }
  | { readonly t: 'falling'; readonly on: boolean }
  | { readonly t: 'shotDone'; readonly feet: number; readonly outcome: ShotOutcome }
  | { readonly t: 'turnStart'; readonly turn: number }
  | { readonly t: 'gameOver'; readonly total: number; readonly shots: readonly number[] };
