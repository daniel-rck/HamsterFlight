import type { Projectile } from "./entities/Projectile.ts";
import type { EffectFlags, PowerupKind, ShotOutcome } from "./types.ts";

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
  /**
   * Ticks since the click while clip 52 plays its wind-up on the pad; null
   * once its frame 28 has lifted the clip and called `jump()`.
   */
  windup: number | null;
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
  /**
   * `windSound`: the wind cue plays on every other wind tick, not every one.
   * Game.as:512-520; reset per shot by `resetSounds()`, Game.as:952.
   */
  windSound: boolean;
}

/**
 * A discriminated union rather than the original's five loose booleans
 * (`shooting`, `faceplant`, `skidding`, `state`, `paused`), several of whose
 * combinations were unreachable only by convention.
 *
 * `settling` has two stages, matching the original's sequence after a shot:
 * the outcome clip plays (`hold`) - a faceplant or a zero hands over to a
 * cheer part-way, as their frame scripts do - then the cheer's (or the
 * hole's) frame 50 calls `setCamReset()` and the camera quick-pans home
 * (`pan`, `GameCamera.doQuickPanTo`); `onDone()` advances the turn on arrival.
 */
export type Phase =
  | { readonly kind: "ready" }
  | { readonly kind: "jumping"; readonly jump: JumpState; readonly camera: CameraState }
  | { readonly kind: "flying"; readonly flight: FlightState }
  | {
      readonly kind: "settling";
      readonly outcome: ShotOutcome;
      readonly feet: number;
      /**
       * Where the shot came down - the `createHitClip(x, y, ...)` arguments,
       * read off `bc._x`/`bc._y` (Game.as:862-875, 964-967). The outcome clip
       * is drawn there, which is why the projectile had to survive
       * `deleteBlt()` in the original.
       */
      x: number;
      readonly y: number;
      /**
       * The clip showing: the outcome's own, until a faceplant or a zero
       * attaches the cheer that follows it.
       */
      clip: ShotOutcome;
      /** Ticks since `clip` was attached. */
      clipTicks: number;
      stage: "hold" | "pan";
      /** Ticks left in the current stage; in `pan` it is the safety cap. */
      ticksLeft: number;
      readonly camera: CameraState;
      /** `cameraTargetX/Y` - the pan's unquantised accumulator. See `quickPanStep`. */
      readonly pan: CameraState;
    }
  | { readonly kind: "gameOver"; readonly total: number };

/** The read-only view the renderer gets. It may not hold the Simulation itself. */
export interface SimSnapshot {
  readonly tick: number;
  readonly phaseKind: Phase["kind"];
  readonly turn: number;
  readonly paused: boolean;
  /** The jump's one pillow swing has been used, hit or miss. False outside `jumping`. */
  readonly swung: boolean;
  /**
   * Ticks into clip 52's wind-up (`JumpState.windup`); null outside `jumping`
   * and once the clip has called `jump()`.
   */
  readonly windup: number | null;
  readonly hamster: {
    readonly x: number;
    readonly y: number;
    readonly xvel: number;
    readonly yvel: number;
    readonly visible: boolean;
    readonly doRotation: boolean;
    /** `bltClip._rotation` in degrees while flying, including the +90. 0 otherwise. */
    readonly rotationDeg: number;
  };
  readonly camera: CameraState;
  readonly powerups: readonly PowerupInstance[];
  readonly glidePoints: number;
  readonly flags: Readonly<EffectFlags>;
  readonly shots: readonly number[];
  readonly feet: number;
  readonly outcome: ShotOutcome | null;
  /** The outcome clip showing - `outcome`, or the cheer that follows it. Null outside `settling`. */
  readonly outcomeClip: ShotOutcome | null;
}
