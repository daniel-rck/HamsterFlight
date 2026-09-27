import { describe, expect, it } from "vitest";
import { decodeRun, encodeRun, MAX_RUN_STEPS, type Run, RunRecorder } from "@/app/recording.ts";
import { replayRun } from "@/app/replay.ts";
import type { InputCommand } from "@/sim/commands.ts";
import { C } from "@/sim/constants.ts";
import { JUMP_WINDUP_TICKS } from "@/sim/phases/JumpPhase.ts";
import { Simulation } from "@/sim/Simulation.ts";

interface Played {
  readonly run: Run;
  readonly shots: readonly number[];
  readonly total: number;
  /** Every flying tick's hamster x, as the live game saw it. */
  readonly xs: readonly number[];
}

/**
 * A whole game played the way the page plays it: commands decided from the
 * last snapshot, recorded, then stepped. `pauses` pauses on those steps and
 * sits paused for a while before a press resumes - the recording must replay
 * through that exactly.
 */
function playGame(seed: number, pauses: readonly number[] = []): Played {
  const sim = new Simulation({ seed });
  const recorder = new RunRecorder(seed);
  let snap = sim.snapshot();
  let jumpTicks = 0;
  // Each miss hands the turn back; swinging at a different moment next time
  // is how a player - and this one - eventually connects.
  let attempt = seed;
  let pausedFor = -1;
  const xs: number[] = [];
  for (let step = 0; step < 60_000; step++) {
    const commands: InputCommand[] = [];
    if (pauses.includes(step)) {
      commands.push({ kind: "togglePause" });
      pausedFor = 0;
    } else if (snap.paused) {
      // Idle while paused, then the press that resumes.
      if (++pausedFor > 25) commands.push({ kind: "press" });
    } else if (snap.phaseKind === "ready" && snap.walkOut === null) {
      commands.push({ kind: "press" }, { kind: "confirm" }, { kind: "release" });
      jumpTicks = 0;
      attempt++;
    } else if (snap.phaseKind === "jumping") {
      jumpTicks++;
      if (
        snap.windup === null &&
        !snap.swung &&
        jumpTicks >= JUMP_WINDUP_TICKS + ((attempt * 7) % 45)
      ) {
        commands.push({ kind: "press" }, { kind: "release" });
      }
    } else if (snap.phaseKind === "flying") {
      if (snap.tick % 16 === 0) commands.push({ kind: "press" });
      else if (snap.tick % 16 === 9) commands.push({ kind: "release" });
    }
    recorder.record(commands, snap.paused);
    const events = sim.step(commands);
    snap = sim.snapshot();
    if (snap.phaseKind === "flying" && !snap.paused) xs.push(snap.hamster.x);
    const over = events.find((e) => e.t === "gameOver");
    if (over !== undefined && over.t === "gameOver") {
      recorder.finish();
      const run = recorder.run();
      if (run === null) throw new Error("finished recorder has no run");
      return { run, shots: over.shots, total: over.total, xs };
    }
  }
  throw new Error(`seed ${seed}: the game never ended (${snap.phaseKind}, turn ${snap.turn})`);
}

describe("a recorded game", () => {
  it("replays to the same shots and the same flights", () => {
    for (const seed of [1, 42, 20260927]) {
      const played = playGame(seed);
      const replay = replayRun(played.run);
      expect(replay).not.toBeNull();
      expect(replay?.shots).toEqual(played.shots);
      expect(replay?.total).toBe(played.total);
      expect(replay?.traces).toHaveLength(C.TURNS);
      expect(replay?.traces.flatMap((t) => t.points.map((p) => p.x))).toEqual(played.xs);
      expect(replay?.traces.map((t) => t.feet)).toEqual(played.shots);
    }
  });

  it("replays through pauses mid-jump and mid-flight", () => {
    const plain = playGame(7);
    const paused = playGame(7, [40, 120, 400]);
    const replay = replayRun(paused.run);
    expect(replay?.shots).toEqual(paused.shots);
    // Paused, empty steps are not recorded: pausing costs the link nothing.
    expect(paused.run.endStep).toBeLessThan(plain.run.endStep + 20);
  });

  it("survives the trip through a URL", () => {
    const played = playGame(99);
    const text = encodeRun(played.run);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRun(text)).toEqual(played.run);
    expect(replayRun(decodeRun(text) as Run)?.total).toBe(played.total);
  });
});

describe("decodeRun", () => {
  it("rejects what is not a run", () => {
    for (const garbage of ["", "A", "!!!!", "AAAA", "____", "not a run at all"]) {
      expect(decodeRun(garbage)).toBeNull();
    }
  });

  it("refuses a run too long to replay", () => {
    const run: Run = { seed: 1, entries: [], endStep: MAX_RUN_STEPS + 1 };
    expect(decodeRun(encodeRun(run))).toBeNull();
  });

  it("does not trust a run that does not end in a game over", () => {
    const played = playGame(3);
    const cut = { ...played.run, endStep: played.run.endStep - 1 };
    expect(replayRun(cut)).toBeNull();
    // Commands shifted by one step play a different game - or none at all.
    const shifted = {
      ...played.run,
      entries: played.run.entries.map((e) => ({ ...e, step: e.step + 1 })),
    };
    expect(replayRun(shifted)?.shots).not.toEqual(played.shots);
  });
});
