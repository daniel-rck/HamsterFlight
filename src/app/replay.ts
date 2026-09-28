import type { Run } from "@/app/recording.ts";
import type { SpriteId } from "@/assets/sprites.generated.ts";
import { poseFor } from "@/render/scene/pose.ts";
import type { InputCommand } from "@/sim/commands.ts";
import { C } from "@/sim/constants.ts";
import { Simulation } from "@/sim/Simulation.ts";
import type { Tuning } from "@/sim/tuning.ts";

/** Where the hamster was on one tick of a replayed flight. */
export interface TracePoint {
  readonly x: number;
  readonly y: number;
  readonly rotationDeg: number;
  readonly pose: SpriteId;
}

/** One shot of a replayed game, from the tick of its launch to the tick it ended. */
export interface ShotTrace {
  readonly points: readonly TracePoint[];
  readonly feet: number;
}

export interface Replay {
  readonly seed: number;
  readonly total: number;
  readonly shots: readonly number[];
  /** Index 0 is turn 1. A missed jump is not a shot, so there are always five. */
  readonly traces: readonly ShotTrace[];
}

/**
 * Plays a recorded game into a fresh simulation and keeps what the ghost needs.
 *
 * The score comes out of this, never out of the link: a shared run says which
 * buttons were pressed when, and the simulation decides how far that went. A
 * run that does not end in a game over on its last step - a hand-edited link,
 * or one recorded against a build whose physics has since changed - is not a
 * game, and comes back null.
 */
export function replayRun(run: Run, tuning?: Tuning): Replay | null {
  const sim = new Simulation(
    tuning === undefined ? { seed: run.seed } : { seed: run.seed, tuning },
  );
  const byStep = new Map<number, readonly InputCommand[]>();
  for (const entry of run.entries) byStep.set(entry.step, entry.commands);

  const traces: ShotTrace[] = [];
  let points: TracePoint[] | null = null;
  for (let step = 0; step <= run.endStep; step++) {
    const events = sim.step(byStep.get(step) ?? []);
    const s = sim.snapshot();
    for (const event of events) {
      if (event.t === "launched") points = [];
    }
    if (points !== null && s.phaseKind === "flying") {
      points.push({
        x: s.hamster.x,
        y: s.hamster.y,
        rotationDeg: s.hamster.rotationDeg,
        pose: poseFor(s),
      });
    }
    for (const event of events) {
      if (event.t === "shotDone" && points !== null) {
        traces.push({ points, feet: event.feet });
        points = null;
      } else if (event.t === "gameOver") {
        if (step !== run.endStep || traces.length !== C.TURNS) return null;
        return { seed: run.seed, total: event.total, shots: event.shots, traces };
      }
    }
  }
  return null;
}
