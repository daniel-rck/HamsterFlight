import { describe, expect, it } from "vitest";
import type { LoopClock } from "@/app/FixedTimestepLoop.ts";
import { createPlay } from "@/app/play.ts";
import { GameSession } from "@/app/session.ts";
import { Effects } from "@/render/effects/Effects.ts";
import { NO_OVERLAY } from "@/render/scene/overlay.ts";
import type { InputCommand } from "@/sim/commands.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";

/** A frame scheduler the test advances by hand, as in loop.spec.ts. */
function fakeClock() {
  let now = 0;
  let pending: ((now: number) => void) | null = null;
  const clock: LoopClock = {
    now: () => now,
    schedule: (callback) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  return {
    clock,
    now: () => now,
    frame(deltaMs: number): void {
      now += deltaMs;
      const run = pending;
      pending = null;
      run?.(now);
    },
    get scheduled() {
      return pending !== null;
    },
  };
}

function harness() {
  const t = fakeClock();
  const draws: Array<{ s: SimSnapshot; now: number }> = [];
  const ticks: SimSnapshot[] = [];
  const queue: InputCommand[] = [];
  let resyncs = 0;
  const effects = new Effects();
  const session = new GameSession({ seed: 7, nextSeed: () => 8, tuning: DEFAULT_TUNING });
  const play = createPlay({
    session,
    input: { drain: () => queue.splice(0), pollGamepads: () => {} },
    meta: { step: () => {}, overlay: () => NO_OVERLAY },
    effects,
    renderer: {
      draw: (s, now) => draws.push({ s, now }),
      resync: () => {
        resyncs++;
      },
    },
    audio: null,
    haptics: null,
    profiler: null,
    pads: () => [],
    onTick: (s) => ticks.push(s),
    onError: () => {},
    now: t.now,
    clock: t.clock,
  });
  return { t, play, draws, ticks, queue, session, effects, resyncs: () => resyncs };
}

describe("Play", () => {
  it("steps the session per tick and reports each new snapshot", () => {
    const h = harness();
    h.play.start();
    h.t.frame(50);
    h.t.frame(50);
    expect(h.ticks.map((s) => s.tick)).toEqual([1, 2]);
    expect(h.play.current).toBe(h.ticks[1]);
  });

  it("draws between the last two ticks, at the frame's own time", () => {
    const h = harness();
    h.queue.push({ kind: "press" }, { kind: "release" });
    h.play.start();
    // Two ticks into the jump, then half of the next one.
    h.t.frame(50);
    h.t.frame(50);
    h.t.frame(25);
    const last = h.draws.at(-1);
    expect(last?.now).toBe(125);
    const [prev, next] = h.ticks.slice(-2);
    if (prev === undefined || next === undefined || last === undefined) throw new Error("no ticks");
    expect(last.s.tick).toBe(next.tick);
    expect(last.s.hamster.y).toBeCloseTo((prev.hamster.y + next.hamster.y) / 2, 9);
  });

  it("draws the new game as it is after a restart, not a blend with the old one", () => {
    const h = harness();
    h.play.restart(99);
    expect(h.session.seed).toBe(99);
    expect(h.play.current).toBe(h.session.snapshot);
    h.play.drawStill();
    expect(h.draws.at(-1)?.s).toBe(h.play.current);
  });

  it("redraws the frame that was on the stage, between the same two ticks", () => {
    const h = harness();
    h.play.redraw();
    expect(h.draws.at(-1)?.s).toBe(h.play.current);

    h.queue.push({ kind: "press" }, { kind: "release" });
    h.play.start();
    h.t.frame(50);
    h.t.frame(50);
    h.t.frame(25);
    const shown = h.draws.at(-1);
    h.play.redraw();
    const again = h.draws.at(-1);
    expect(again).not.toBe(shown);
    expect(again?.s).toEqual(shown?.s);
  });

  it("resumes only a game that has started, and clears what was in flight", () => {
    const h = harness();
    h.play.resume();
    expect(h.t.scheduled).toBe(false);
    expect(h.resyncs()).toBe(0);

    h.play.start();
    h.play.stop();
    h.effects.emitSkidDust(100, 950, 0);
    h.play.resume();
    expect(h.t.scheduled).toBe(true);
    expect(h.resyncs()).toBe(1);
    expect(h.effects.particles(1)).toHaveLength(0);
  });
});
