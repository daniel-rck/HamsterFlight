import { describe, expect, it } from 'vitest';
import {
  FixedTimestepLoop,
  GAP_THRESHOLD_MS,
  type LoopClock,
  MAX_STEPS_PER_FRAME,
  STEP_MS,
} from '@/app/FixedTimestepLoop.ts';

/** A scheduler the test advances by hand. */
function fakeClock() {
  let now = 0;
  let pending: ((now: number) => void) | null = null;
  let cancelled = 0;
  const clock: LoopClock = {
    now: () => now,
    schedule: callback => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      cancelled++;
      pending = null;
    },
  };
  return {
    clock,
    /** Advance the clock and run the pending frame. */
    frame(deltaMs: number): void {
      now += deltaMs;
      const run = pending;
      pending = null;
      run?.(now);
    },
    get cancelled() {
      return cancelled;
    },
    get scheduled() {
      return pending !== null;
    },
  };
}

function harness() {
  const t = fakeClock();
  const draws: Array<{ alpha: number; stepped: boolean }> = [];
  let steps = 0;
  const loop = new FixedTimestepLoop(
    {
      step: () => {
        steps++;
      },
      draw: (alpha, stepped) => draws.push({ alpha, stepped }),
    },
    t.clock,
  );
  return { t, loop, draws, steps: () => steps };
}

describe('FixedTimestepLoop', () => {
  it('steps once per 50 ms however the frames fall', () => {
    const { t, loop, draws, steps } = harness();
    loop.start();
    for (let i = 0; i < 6; i++) t.frame(16); // 96 ms
    expect(steps()).toBe(1);
    expect(draws.filter(d => d.stepped)).toHaveLength(1);
    // Alpha is the fraction of the way to the next tick.
    expect(draws.at(-1)?.alpha).toBeCloseTo((96 - STEP_MS) / STEP_MS, 10);
    t.frame(4); // exactly 100 ms
    expect(steps()).toBe(2);
    expect(draws.at(-1)?.alpha).toBe(0);
  });

  it('refuses to fast-forward after a long gap', () => {
    const { t, loop, steps } = harness();
    loop.start();
    t.frame(GAP_THRESHOLD_MS + 5000);
    // A returning tab gets exactly one tick, not a hundred.
    expect(steps()).toBe(1);
  });

  it('caps the steps per frame and bleeds the surplus', () => {
    const { t, loop, steps, draws } = harness();
    loop.start();
    t.frame(GAP_THRESHOLD_MS); // right at the threshold: counted in full
    expect(steps()).toBe(MAX_STEPS_PER_FRAME);
    expect(draws.at(-1)?.alpha).toBe(0);
  });

  it('draws every frame, marking idle ones', () => {
    const { t, loop, draws } = harness();
    loop.start();
    t.frame(10);
    t.frame(10);
    expect(draws).toEqual([
      { alpha: 0.2, stepped: false },
      { alpha: 0.4, stepped: false },
    ]);
  });

  it('stops and cancels the frame', () => {
    const { t, loop } = harness();
    loop.start();
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(t.cancelled).toBe(1);
    expect(t.scheduled).toBe(false);
  });

  it('stops after a hook throws instead of throwing every frame', () => {
    const t = fakeClock();
    let calls = 0;
    const loop = new FixedTimestepLoop(
      {
        step: () => {
          calls++;
          throw new Error('renderer broke');
        },
        draw: () => undefined,
      },
      t.clock,
    );
    loop.start();
    expect(() => t.frame(STEP_MS)).toThrow('renderer broke');
    expect(loop.running).toBe(false);
    expect(t.scheduled).toBe(false);
    t.frame(STEP_MS);
    expect(calls).toBe(1);
  });
});
