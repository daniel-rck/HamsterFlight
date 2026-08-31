import { describe, expect, it } from 'vitest';
import { Effects } from '@/render/effects/Effects.ts';
import type { SimEvent } from '@/sim/events.ts';

/** fx/break has 4 frames at 19 fps, so it lives about 210 ms. */
const BREAK: SimEvent = { t: 'fx', id: 'break', x: 100, y: 955 };
const FRAME_MS = 1000 / 19;

describe('Effects', () => {
  it('turns an fx cue into a clip at the reported world position', () => {
    const effects = new Effects();
    effects.consume([BREAK], 1000);

    const active = effects.active(1000);
    expect(active).toHaveLength(1);
    expect(active[0]).toEqual({ sprite: 'fx/break', frame: 0, x: 100, y: 955 });
  });

  it('advances frames on wall-clock time and drops the clip when it runs out', () => {
    const effects = new Effects();
    effects.consume([BREAK], 0);

    expect(effects.active(FRAME_MS * 2)[0]?.frame).toBe(2);
    expect(effects.active(FRAME_MS * 3.9)[0]?.frame).toBe(3);
    expect(effects.active(FRAME_MS * 4)).toHaveLength(0);
    // Dropped for good, not merely hidden for that one query.
    expect(effects.active(FRAME_MS * 2)).toHaveLength(0);
  });

  it('keeps concurrent clips apart', () => {
    const effects = new Effects();
    effects.consume([BREAK], 0);
    effects.consume([{ t: 'fx', id: 'bounceFx', x: 7, y: 955 }], FRAME_MS * 2);

    const active = effects.active(FRAME_MS * 2);
    expect(active.map(fx => fx.sprite)).toEqual(['fx/break', 'fx/bounce']);
    expect(active.map(fx => fx.frame)).toEqual([2, 0]);
  });

  it('ignores every cue that is not an fx one', () => {
    const effects = new Effects();
    effects.consume(
      [
        { t: 'sfx', id: 'bump' },
        { t: 'pickup', kind: 'bounce' },
        { t: 'shotDone', feet: 12, outcome: 'cheer' },
      ],
      0,
    );
    expect(effects.active(0)).toHaveLength(0);
  });

  it('clears clips in flight, so a backgrounded tab does not expire them at once', () => {
    const effects = new Effects();
    effects.consume([BREAK], 0);
    effects.clear();
    expect(effects.active(0)).toHaveLength(0);
  });
});
