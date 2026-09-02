import type { Projectile } from './entities/Projectile.ts';
import type { EffectFlags, PowerupKind, ShotOutcome } from './types.ts';

/**
 * Mutability convention: phase payloads (`JumpState`, `FlightState`,
 * `CameraState`, the `settling` counters) are the simulation's working state
 * and are mutated in place by the phase steppers. `readonly` on a field here
 * means "the reference is fixed", not "the object is immutable". `SimSnapshot`
 * at the bottom is the one genuinely immutable shape - it is a copy.
 */

export interface PowerupInstance {
  readonly kind: PowerupKind;
  readonly x: number;
  readonly y: number;
  /** Consumed, but possibly still overlapping - see `Tuning.powerupActiveTicks`. */
  taken: boolean;
  activeTicksLeft: number;
}

export interface JumpState {
  y: number;
  yvel: number;
  /** The one-shot boost below y = 930 fires once per jump. */
  boost: boolean;
  /** The pillow swings once per jump, hit or miss. Game.as:1029-1037. */
  swung: boolean;
}

export interface CameraState {
  /** Negative container offsets, exactly as `getCameraPos()` returns them. */
  x: number;
  y: number;
}

export interface FlightState {
  readonly p: Projectile;
  readonly flags: EffectFlags;
  glidePoints: number;
  /** True between `press` and `release`, independent of whether lift applies. */
  gravButton: boolean;
  readonly powerups: PowerupInstance[];
  powerupMark: number;
  readonly camera: CameraState;
  outcome: ShotOutcome | null;
  /** `slideSound` / `skidSound` - whether the loop has been started. Game.as:561, 580. */
  slideSound: boolean;
  skidSound: boolean;
}

/**
 * A discriminated union rather than the original's five loose booleans
 * (`shooting`, `faceplant`, `skidding`, `state`, `paused`), several of whose
 * combinations were unreachable only by convention.
 *
 * `settling` has two stages, matching the original's sequence after a shot:
 * the outcome clip plays (`hold`, `Tuning.outcomeHoldTicks`), then its last
 * frame calls `setCamReset()` and the camera quick-pans home (`pan`,
 * `GameCamera.doQuickPanTo`); `onDone()` advances the turn on arrival.
 */
export type Phase =
  | { readonly kind: 'ready' }
  | { readonly kind: 'jumping'; readonly jump: JumpState; readonly camera: CameraState }
  | { readonly kind: 'flying'; readonly flight: FlightState }
  | {
      readonly kind: 'settling';
      readonly outcome: ShotOutcome;
      readonly feet: number;
      /**
       * Where the shot came down - the `createHitClip(x, y, ...)` arguments,
       * read off `bc._x`/`bc._y` (Game.as:862-875, 964-967). The outcome clip
       * is drawn there, which is why the projectile had to survive
       * `deleteBlt()` in the original.
       */
      readonly x: number;
      readonly y: number;
      stage: 'hold' | 'pan';
      /** Ticks left in the current stage; in `pan` it is the safety cap. */
      ticksLeft: number;
      readonly camera: CameraState;
    }
  | { readonly kind: 'gameOver'; readonly total: number };

/** The read-only view the renderer gets. It may not hold the Simulation itself. */
export interface SimSnapshot {
  readonly tick: number;
  readonly phaseKind: Phase['kind'];
  readonly turn: number;
  readonly paused: boolean;
  readonly hamster: {
    readonly x: number;
    readonly y: number;
    readonly xvel: number;
    readonly yvel: number;
    readonly visible: boolean;
    readonly doRotation: boolean;
  };
  readonly camera: CameraState;
  readonly powerups: readonly PowerupInstance[];
  readonly glidePoints: number;
  readonly flags: Readonly<EffectFlags>;
  readonly shots: readonly number[];
  readonly feet: number;
  readonly outcome: ShotOutcome | null;
}
