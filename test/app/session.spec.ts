import { describe, expect, it } from "vitest";
import { replayRun } from "@/app/replay.ts";
import { GameSession, type SessionStep } from "@/app/session.ts";
import type { InputCommand } from "@/sim/commands.ts";
import { Simulation } from "@/sim/Simulation.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";

/** A player good enough to finish a game: swings earlier after every miss. */
function player(): (s: SimSnapshot) => InputCommand[] {
  let jumpTicks = 0;
  let attempt = 0;
  return (s) => {
    if (s.phaseKind === "ready" && s.walkOut === null) {
      jumpTicks = 0;
      attempt++;
      return [{ kind: "press" }, { kind: "confirm" }, { kind: "release" }];
    }
    if (s.phaseKind === "jumping" && s.windup === null && !s.swung) {
      if (++jumpTicks >= (attempt * 7) % 45) return [{ kind: "press" }, { kind: "release" }];
    }
    return [];
  };
}

function playToGameOver(session: GameSession): SessionStep {
  const decide = player();
  for (let i = 0; i < 20_000; i++) {
    const result = session.step(decide(session.snapshot));
    if (result.finished !== null) return result;
  }
  throw new Error("the game never ended");
}

function waitForPlayAgain(session: GameSession): void {
  for (let i = 0; i < 200 && !session.snapshot.restartable; i++) session.step([]);
  expect(session.snapshot.restartable).toBe(true);
}

describe("GameSession", () => {
  it("hands back each finished game as a run that replays to its score", () => {
    const session = new GameSession({ seed: 5, nextSeed: () => 6, tuning: DEFAULT_TUNING });
    const over = playToGameOver(session);
    expect(over.finished?.run.seed).toBe(5);
    expect(replayRun(over.finished!.run)?.total).toBe(over.finished?.total);
  });

  it("starts the next game from a fresh seed, so it replays on its own", () => {
    const seeds = [11, 12];
    const session = new GameSession({
      seed: 10,
      nextSeed: () => seeds.shift() ?? 0,
      tuning: DEFAULT_TUNING,
    });
    playToGameOver(session);
    waitForPlayAgain(session);
    const restart = session.step([{ kind: "press" }, { kind: "confirm" }]);
    expect(restart.restarted).toBe(true);
    expect(session.seed).toBe(11);
    // The PLAY AGAIN click is not also the new game's first jump.
    expect(restart.snapshot.phaseKind).toBe("ready");
    expect(restart.snapshot.turn).toBe(1);
    expect(restart.snapshot.shots).toEqual([]);

    const second = playToGameOver(session);
    expect(second.finished?.run.seed).toBe(11);
    expect(replayRun(second.finished!.run)?.shots).toEqual(second.finished?.shots);
  });

  it("cues the same sounds the simulation's own restart does", () => {
    // What `reset()` emits, read off a simulation driven to its PLAY AGAIN.
    const sim = new Simulation({ seed: 3 });
    const decide = player();
    for (let i = 0; i < 20_000 && !sim.snapshot().restartable; i++)
      sim.step(decide(sim.snapshot()));
    const original = sim.step([{ kind: "confirm" }]);

    const session = new GameSession({ seed: 3, nextSeed: () => 4, tuning: DEFAULT_TUNING });
    playToGameOver(session);
    waitForPlayAgain(session);
    const restart = session.step([{ kind: "confirm" }]);

    const cues = (events: readonly { t: string; id?: string }[]): string[] =>
      events.map((e) => `${e.t}:${e.id ?? ""}`).sort();
    expect(cues(restart.events)).toEqual(cues(original));
  });

  it("ignores a confirm before PLAY AGAIN is up", () => {
    const session = new GameSession({ seed: 8, nextSeed: () => 9, tuning: DEFAULT_TUNING });
    playToGameOver(session);
    expect(session.snapshot.restartable).toBe(false);
    expect(session.step([{ kind: "confirm" }]).restarted).toBe(false);
    expect(session.seed).toBe(8);
  });
});
