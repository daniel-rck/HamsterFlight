import { type Run, RunRecorder } from "@/app/recording.ts";
import type { InputCommand } from "@/sim/commands.ts";
import type { SimEvent } from "@/sim/events.ts";
import { Simulation } from "@/sim/Simulation.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import type { Tuning } from "@/sim/tuning.ts";

export interface FinishedGame {
  readonly run: Run;
  readonly total: number;
  readonly shots: readonly number[];
}

export interface SessionStep {
  readonly events: readonly SimEvent[];
  readonly snapshot: SimSnapshot;
  /** Set on the step a game ended on. */
  readonly finished: FinishedGame | null;
  /** This step began a new game - PLAY AGAIN built a fresh simulation. */
  readonly restarted: boolean;
}

export interface SessionOptions {
  readonly seed: number;
  /** The seed for the game after `seed`'s, and after that one. */
  readonly nextSeed: () => number;
  readonly tuning: Tuning;
}

/**
 * The simulation the page is playing, and the recording of it.
 *
 * PLAY AGAIN is where this differs from the original. The simulation's own
 * restart (`reset()`) keeps its random streams running, so a second game could
 * only be reproduced by replaying the first one too. Here PLAY AGAIN builds a
 * new `Simulation` from a new seed instead, so every game is `(seed, inputs)`
 * on its own - which is what lets one game be shared, replayed or raced. The
 * sounds are the ones `reset()` cues: the new simulation's first step starts
 * the menu music, and the theme stop is added here.
 */
export class GameSession {
  readonly #nextSeed: () => number;
  readonly #tuning: Tuning;
  #sim: Simulation;
  #recorder: RunRecorder;
  #snapshot: SimSnapshot;

  constructor(options: SessionOptions) {
    this.#nextSeed = options.nextSeed;
    this.#tuning = options.tuning;
    this.#sim = new Simulation({ seed: options.seed, tuning: options.tuning });
    this.#recorder = new RunRecorder(options.seed);
    this.#snapshot = this.#sim.snapshot();
  }

  get seed(): number {
    return this.#recorder.seed;
  }

  get snapshot(): SimSnapshot {
    return this.#snapshot;
  }

  step(commands: readonly InputCommand[]): SessionStep {
    let prefix: SimEvent[] = [];
    let input = commands;
    let restarted = false;
    if (this.#snapshot.restartable && commands.some((c) => c.kind === "confirm")) {
      const seed = this.#nextSeed();
      this.#sim = new Simulation({ seed, tuning: this.#tuning });
      this.#recorder = new RunRecorder(seed);
      // `reset()`'s `theme.stop()`; the prelude comes from the new game's first step.
      prefix = [{ t: "sfxStop", id: "theme" }];
      // The click was PLAY AGAIN's, not the new game's first jump.
      input = [];
      restarted = true;
    }

    this.#recorder.record(input, this.#snapshot.paused);
    const events = this.#sim.step(input);
    this.#snapshot = this.#sim.snapshot();

    let finished: FinishedGame | null = null;
    for (const event of events) {
      if (event.t !== "gameOver") continue;
      this.#recorder.finish();
      const run = this.#recorder.run();
      if (run !== null) finished = { run, total: event.total, shots: event.shots };
    }
    return {
      events: prefix.length > 0 ? [...prefix, ...events] : events,
      snapshot: this.#snapshot,
      finished,
      restarted,
    };
  }
}
