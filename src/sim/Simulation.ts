import type { InputCommand } from './commands.ts';
import { C } from './constants.ts';
import { Projectile } from './entities/Projectile.ts';
import type { SimEvent } from './events.ts';
import { stepFlight } from './phases/FlightPhase.ts';
import { beginJump, stepJump } from './phases/JumpPhase.ts';
import { attemptLaunch } from './phases/Launch.ts';
import { mulberry32 } from './rng/mulberry32.ts';
import type { Rng } from './rng/Rng.ts';
import type { FlightState, Phase, SimSnapshot } from './state.ts';
import { follow, newCamera } from './systems/CameraModel.ts';
import { DEFAULT_TUNING, type Tuning } from './tuning.ts';
import { noEffects, type ShotOutcome } from './types.ts';

export interface SimulationOptions {
  readonly seed: number;
  readonly tuning?: Tuning;
}

/**
 * The whole game, headless and deterministic. Given a seed and a command
 * stream it always produces the same trajectory, which is what makes the
 * golden regression tests possible.
 *
 * This is the only mutator in `src/sim`. The renderer reads `snapshot()` and
 * may not hold a reference to this object.
 */
export class Simulation {
  #tick = 0;
  #turn = 1;
  #paused = false;
  #shots: number[] = [];
  #phase: Phase;
  #rngJump: Rng;
  #rngPowerups: Rng;
  readonly #tuning: Tuning;
  #lastFeet = 0;

  constructor(options: SimulationOptions) {
    this.#tuning = options.tuning ?? DEFAULT_TUNING;
    const master = mulberry32(options.seed);
    // Separate streams so that changing spawn code cannot shift the jump
    // sequence, keeping goldens narrowly scoped. The original drew both from
    // one shared Math.random stream; unobservable, since its seed is unknowable.
    this.#rngJump = master.fork('jump');
    this.#rngPowerups = master.fork('powerups');
    this.#phase = { kind: 'ready' };
  }

  get tick(): number {
    return this.#tick;
  }

  get phaseKind(): Phase['kind'] {
    return this.#phase.kind;
  }

  /** Advance exactly one 50 ms tick. */
  step(commands: readonly InputCommand[] = []): readonly SimEvent[] {
    const out: SimEvent[] = [];

    for (const cmd of commands) {
      if (cmd.kind === 'togglePause') this.#paused = !this.#paused;
    }
    if (this.#paused) return out;

    for (const cmd of commands) this.#handle(cmd, out);

    this.#tick++;

    switch (this.#phase.kind) {
      case 'jumping': {
        const st = this.#phase.jump;
        const landed = stepJump(st, this.#rngJump, out);
        follow(this.#phase.camera, C.HAMSTER_X, st.y);
        if (landed) this.#endShot('zero', 0, out);
        break;
      }
      case 'flying': {
        const flight = this.#phase.flight;
        const done = stepFlight(flight, this.#tuning, this.#rngPowerups, out);
        if (done) {
          const feet = Math.floor(flight.p.x / C.PX_PER_FOOT);
          this.#endShot(flight.outcome ?? 'cheer', feet, out);
        }
        break;
      }
      case 'settling': {
        this.#phase.ticksLeft--;
        if (this.#phase.ticksLeft <= 0) this.#advanceTurn(out);
        break;
      }
      default:
        break;
    }

    return out;
  }

  #handle(cmd: InputCommand, out: SimEvent[]): void {
    const phase = this.#phase;

    if (cmd.kind === 'press') {
      if (phase.kind === 'ready') {
        this.#phase = { kind: 'jumping', jump: beginJump(this.#rngJump), camera: newCamera() };
        out.push({ t: 'turnStart', turn: this.#turn });
        out.push({ t: 'sfx', id: 'jump', gain: C.SFX_VOLUME });
        return;
      }
      if (phase.kind === 'jumping') {
        out.push({ t: 'sfx', id: 'shoot', gain: C.SFX_VOLUME });
        this.#launch(out);
        return;
      }
      if (phase.kind === 'flying') {
        const f = phase.flight;
        // `shooting && !skidding` - Game.as:1039. Note there is no gravPoints
        // check: pressing on an empty meter still buys exactly one tick of
        // lift, because only step 12 drains and restores.
        if (f.flags.skidding) return;
        f.p.setGlideGravity();
        f.gravButton = true;
        if (!f.flags.glide && !f.flags.falling) {
          f.flags.glide = true;
          out.push({ t: 'glide', on: true });
        }
      }
      return;
    }

    if (cmd.kind === 'release') {
      if (phase.kind === 'flying') {
        phase.flight.p.restoreGravity();
        phase.flight.gravButton = false;
        if (phase.flight.flags.glide) {
          phase.flight.flags.glide = false;
          out.push({ t: 'glide', on: false });
        }
      }
      return;
    }

    if (cmd.kind === 'confirm' && phase.kind === 'gameOver') {
      this.#turn = 1;
      this.#shots = [];
      this.#lastFeet = 0;
      this.#phase = { kind: 'ready' };
    }
  }

  #launch(out: SimEvent[]): void {
    if (this.#phase.kind !== 'jumping') return;
    const result = attemptLaunch(this.#phase.jump, this.#tuning);

    if (!result.hit) {
      // A miss does not end the jump - it runs on until the faceplant.
      out.push({ t: 'missed' });
      return;
    }

    const p = new Projectile(C.HAMSTER_X, result.y, result.vel, result.angleRad, C.GRAV);
    const flight: FlightState = {
      p,
      flags: noEffects(),
      glidePoints: C.GLIDE_MAX,
      gravButton: false,
      powerups: [],
      // 650 on the first shot of a session, 600 afterwards - Game.as:147 vs 1389.
      powerupMark: this.#turn === 1 ? C.POWERUP_MARK_INIT : C.POWERUP_MARK_RESET,
      camera: newCamera(),
      outcome: null,
    };
    follow(flight.camera, p.x, p.y);

    out.push({ t: 'launched', vel: result.vel, angleDeg: result.angleDeg });
    out.push({ t: 'sfx', id: 'fly', gain: C.SFX_VOLUME, loop: true });
    out.push({ t: 'sfx', id: 'theme', gain: C.MUSIC_VOL, loop: true });
    this.#phase = { kind: 'flying', flight };
  }

  #endShot(outcome: ShotOutcome, feet: number, out: SimEvent[]): void {
    this.#lastFeet = feet;
    this.#shots.push(feet);
    out.push({ t: 'shotDone', feet, outcome });
    const camera =
      this.#phase.kind === 'flying'
        ? this.#phase.flight.camera
        : this.#phase.kind === 'jumping'
          ? this.#phase.camera
          : newCamera();
    this.#phase = {
      kind: 'settling',
      outcome,
      feet,
      ticksLeft: this.#tuning.outcomeHoldTicks[outcome] ?? 20,
      camera,
    };
  }

  #advanceTurn(out: SimEvent[]): void {
    this.#turn++;
    if (this.#turn >= C.GAME_OVER_TURN) {
      const total = this.#shots.reduce((a, b) => a + b, 0);
      out.push({ t: 'gameOver', total, shots: [...this.#shots] });
      out.push({ t: 'sfx', id: 'ending', gain: C.MUSIC_VOL });
      this.#phase = { kind: 'gameOver', total };
      return;
    }
    this.#phase = { kind: 'ready' };
  }

  snapshot(): SimSnapshot {
    const phase = this.#phase;
    const base = {
      tick: this.#tick,
      phaseKind: phase.kind,
      turn: this.#turn,
      paused: this.#paused,
      shots: this.#shots as readonly number[],
      feet: this.#lastFeet,
    };

    if (phase.kind === 'flying') {
      const f = phase.flight;
      return {
        ...base,
        hamster: {
          x: f.p.x,
          y: f.p.y,
          xvel: f.p.xvel,
          yvel: f.p.yvel,
          visible: true,
          doRotation: f.p.doRotation,
        },
        camera: { ...f.camera },
        powerups: f.powerups.map(it => ({ ...it })),
        glidePoints: f.glidePoints,
        flags: { ...f.flags },
        feet: Math.floor(f.p.x / C.PX_PER_FOOT),
        outcome: f.outcome,
      };
    }

    if (phase.kind === 'jumping') {
      return {
        ...base,
        hamster: {
          x: C.HAMSTER_X,
          y: phase.jump.y,
          xvel: 0,
          yvel: phase.jump.yvel,
          visible: true,
          doRotation: false,
        },
        camera: { ...phase.camera },
        powerups: [],
        glidePoints: C.GLIDE_MAX,
        flags: noEffects(),
        outcome: null,
      };
    }

    const camera = phase.kind === 'settling' ? { ...phase.camera } : newCamera();
    return {
      ...base,
      hamster: {
        x: C.HAMSTER_X,
        y: C.HAMSTER_START_Y,
        xvel: 0,
        yvel: 0,
        visible: phase.kind === 'ready',
        doRotation: false,
      },
      camera,
      powerups: [],
      glidePoints: C.GLIDE_MAX,
      flags: noEffects(),
      outcome: phase.kind === 'settling' ? phase.outcome : null,
    };
  }
}
