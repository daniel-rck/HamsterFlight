import type { InputCommand } from '@/sim/commands.ts';
import { C } from '@/sim/constants.ts';
import { Projectile } from '@/sim/entities/Projectile.ts';
import type { SimEvent } from '@/sim/events.ts';
import { stepFlight } from '@/sim/phases/FlightPhase.ts';
import { mulberry32 } from '@/sim/rng/mulberry32.ts';
import type { Rng } from '@/sim/rng/Rng.ts';
import { Simulation } from '@/sim/Simulation.ts';
import type { FlightState, PowerupInstance, SimSnapshot } from '@/sim/state.ts';
import { newCamera } from '@/sim/systems/CameraModel.ts';
import { DEFAULT_TUNING, type Tuning } from '@/sim/tuning.ts';
import { type EffectFlags, noEffects, type PowerupKind, type ShotOutcome } from '@/sim/types.ts';

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
}

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
    powerupMark: Number.POSITIVE_INFINITY, // spawning off unless a test wants it
    camera: newCamera(),
    outcome: null,
    slideSound: false,
    skidSound: false,
  };
}

export interface TickResult {
  readonly done: boolean;
  readonly events: readonly SimEvent[];
}

export function tick(s: FlightState, options: { tuning?: Tuning; rng?: Rng } = {}): TickResult {
  const events: SimEvent[] = [];
  const done = stepFlight(
    s,
    options.tuning ?? DEFAULT_TUNING,
    options.rng ?? mulberry32(1),
    events,
  );
  return { done, events };
}

/** A tuning override with one powerup's overlap duration changed. */
export function withActiveTicks(kind: PowerupKind, ticks: number): Tuning {
  return {
    ...DEFAULT_TUNING,
    powerupActiveTicks: { ...DEFAULT_TUNING.powerupActiveTicks, [kind]: ticks },
  };
}

// -- full-shot harness ------------------------------------------------------

/** A hold policy decides, per tick, whether the button is down. */
export type HoldPolicy = (s: SimSnapshot) => boolean;

export interface ShotResult {
  readonly feet: number;
  readonly outcome: ShotOutcome | 'miss';
  readonly ticks: number;
  /** Highest point reached, in px above the launch height. */
  readonly peakUp: number;
}

/**
 * Plays one complete shot: press to jump, wait `clickTick` ticks, press again
 * to hit the pillow, then fly under `hold`. This is the successor to
 * `reference/legacy/sim.js`, running the real engine instead of a paraphrase.
 */
export function runFullShot(options: {
  seed: number;
  clickTick: number;
  hold?: HoldPolicy;
  tuning?: Tuning;
  maxTicks?: number;
}): ShotResult {
  const sim = new Simulation({ seed: options.seed, tuning: options.tuning ?? DEFAULT_TUNING });
  const hold = options.hold ?? (() => false);
  const maxTicks = options.maxTicks ?? 6000;

  sim.step([{ kind: 'press' }, { kind: 'release' }]);
  for (let t = 0; t < options.clickTick && sim.phaseKind === 'jumping'; t++) sim.step();

  if (sim.phaseKind !== 'jumping') {
    return { feet: 0, outcome: 'zero', ticks: sim.tick, peakUp: 0 };
  }

  const launchEvents = sim.step([{ kind: 'press' }, { kind: 'release' }]);
  if (launchEvents.some(e => e.t === 'missed')) {
    return { feet: 0, outcome: 'miss', ticks: sim.tick, peakUp: 0 };
  }

  const launchY = sim.snapshot().hamster.y;
  let minY = launchY;
  let down = false;
  let feet = 0;
  let outcome: ShotOutcome = 'cheer';

  for (let t = 0; t < maxTicks; t++) {
    const snap = sim.snapshot();
    if (snap.phaseKind !== 'flying') break;
    if (snap.hamster.y < minY) minY = snap.hamster.y;

    const want = hold(snap);
    const commands: InputCommand[] = [];
    if (want && !down) commands.push({ kind: 'press' });
    else if (!want && down) commands.push({ kind: 'release' });
    down = want;

    for (const ev of sim.step(commands)) {
      if (ev.t === 'shotDone') {
        feet = ev.feet;
        outcome = ev.outcome;
      }
    }
  }

  return { feet, outcome, ticks: sim.tick, peakUp: Math.round(launchY - minY) };
}

/** Never touch the button. */
export const never: HoldPolicy = () => false;
/** Mash: hold whenever there is any glide left. */
export const mash: HoldPolicy = s => s.glidePoints > 0;
/** Hold only while not already climbing hard - the doc's "smart" strategy. */
export const smart: HoldPolicy = s => s.glidePoints > 0 && s.hamster.yvel > -5;
