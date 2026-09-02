import { C } from '@/sim/constants.ts';
import { Projectile } from '@/sim/entities/Projectile.ts';
import type { SimEvent } from '@/sim/events.ts';
import { stepFlight } from '@/sim/phases/FlightPhase.ts';
import { mulberry32 } from '@/sim/rng/mulberry32.ts';
import type { Rng } from '@/sim/rng/Rng.ts';
import type { FlightState, PowerupInstance } from '@/sim/state.ts';
import { newCamera } from '@/sim/systems/CameraModel.ts';
import { DEFAULT_TUNING, type Tuning } from '@/sim/tuning.ts';
import { type EffectFlags, noEffects, type PowerupKind } from '@/sim/types.ts';

export type { HoldPolicy, ShotResult } from '@/sim/drive.ts';
export { bestShot, hold, mash, median, never, runShot, smart } from '@/sim/drive.ts';

export interface FlightSetup {
  readonly x?: number;
  readonly y?: number;
  readonly xvel?: number;
  readonly yvel?: number;
  readonly ox?: number;
  readonly oy?: number;
  readonly grav?: number;
  readonly hit?: boolean;
  readonly glidePoints?: number;
  readonly gravButton?: boolean;
  readonly flags?: Partial<EffectFlags>;
  readonly powerups?: readonly Omit<PowerupInstance, 'taken' | 'activeTicksLeft'>[];
  /** Spawning is off unless a test wants it; this is the first spawn gate. */
  readonly powerupMark?: number;
}

/**
 * Spawning off by default. Not `Infinity`: the gate is compared with the
 * camera, and a non-finite value in numeric physics state is a trap for the
 * next person who subtracts from it.
 */
const NO_SPAWNING = Number.MAX_SAFE_INTEGER;

/** Build a flight state directly, so single ticks can be examined in isolation. */
export function makeFlight(setup: FlightSetup = {}): FlightState {
  const p = new Projectile(
    setup.x ?? C.HAMSTER_X,
    setup.y ?? C.PILLOW_CLAMP_Y,
    0,
    0,
    setup.grav ?? C.GRAV,
  );
  p.xvel = setup.xvel ?? 0;
  p.yvel = setup.yvel ?? 0;
  p.ox = setup.ox ?? p.x;
  p.oy = setup.oy ?? p.y;
  p.hit = setup.hit ?? false;

  return {
    p,
    flags: { ...noEffects(), ...setup.flags },
    glidePoints: setup.glidePoints ?? C.GLIDE_MAX,
    gravButton: setup.gravButton ?? false,
    powerups: (setup.powerups ?? []).map(it => ({ ...it, taken: false, activeTicksLeft: 0 })),
    powerupMark: setup.powerupMark ?? NO_SPAWNING,
    camera: newCamera(),
    outcome: null,
    slideSound: false,
    skidSound: false,
  };
}

/** A pickup of `kind` whose core is centred on the hamster's flight core at (x, y). */
export function centredOn(
  kind: PowerupKind,
  x: number,
  y: number,
  tuning: Tuning = DEFAULT_TUNING,
): Omit<PowerupInstance, 'taken' | 'activeTicksLeft'> {
  const hamster = tuning.boxes.hamsterFlightCore;
  const item = tuning.boxes.powerups[kind];
  return { kind, x: x + hamster.cx - item.cx, y: y + hamster.cy - item.cy };
}

export interface TickResult {
  readonly done: boolean;
  readonly events: readonly SimEvent[];
}

/**
 * One stream per flight state, so a test that enables spawning draws fresh
 * rolls on every tick rather than the same first roll over and over.
 */
const streams = new WeakMap<FlightState, Rng>();

export function tick(s: FlightState, options: { tuning?: Tuning; rng?: Rng } = {}): TickResult {
  let rng = options.rng ?? streams.get(s);
  if (rng === undefined) {
    rng = mulberry32(1);
    streams.set(s, rng);
  }
  const events: SimEvent[] = [];
  const done = stepFlight(s, options.tuning ?? DEFAULT_TUNING, rng, events);
  return { done, events };
}

/** A tuning override with one powerup's overlap duration changed. */
export function withActiveTicks(kind: PowerupKind, ticks: number): Tuning {
  return {
    ...DEFAULT_TUNING,
    powerupActiveTicks: { ...DEFAULT_TUNING.powerupActiveTicks, [kind]: ticks },
  };
}
