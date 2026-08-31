import type { Projectile } from './entities/Projectile.ts';
import type { EffectFlags, PowerupKind, ShotOutcome } from './types.ts';

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
}

/**
 * A discriminated union rather than the original's five loose booleans
 * (`shooting`, `faceplant`, `skidding`, `state`, `paused`), several of whose
 * combinations were unreachable only by convention.
 */
export type Phase =
  | { readonly kind: 'ready' }
  | { readonly kind: 'jumping'; readonly jump: JumpState; readonly camera: CameraState }
  | { readonly kind: 'flying'; readonly flight: FlightState }
  | {
      readonly kind: 'settling';
      readonly outcome: ShotOutcome;
      readonly feet: number;
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
