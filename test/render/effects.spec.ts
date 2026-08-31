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

describe('Effects camera shake', () => {
  const enhanced = (): Effects => new Effects({ shake: true });

  it('stays perfectly still in faithful mode', () => {
    const effects = new Effects();
    effects.consume([{ t: 'fx', id: 'superBreak', x: 0, y: 955 }], 0);
    expect(effects.shakeOffset(0)).toEqual({ x: 0, y: 0 });
    expect(effects.shakeOffset(50)).toEqual({ x: 0, y: 0 });
  });

  it('is deterministic - the same impact time gives the same offset', () => {
    const a = enhanced();
    const b = enhanced();
    a.consume([BREAK], 1234);
    b.consume([BREAK], 1234);
    for (const at of [1234, 1290, 1400, 1489]) {
      expect(a.shakeOffset(at)).toEqual(b.shakeOffset(at));
    }
  });

  it('decays to exactly zero and stays there', () => {
    const effects = enhanced();
    effects.consume([BREAK], 0);
    const early = Math.abs(effects.shakeOffset(20).x) + Math.abs(effects.shakeOffset(20).y);
    const late = Math.abs(effects.shakeOffset(200).x) + Math.abs(effects.shakeOffset(200).y);
    expect(early).toBeGreaterThan(late);
    expect(effects.shakeOffset(260)).toEqual({ x: 0, y: 0 });
    expect(effects.shakeOffset(10_000)).toEqual({ x: 0, y: 0 });
  });

  it('never exceeds the impact amplitude', () => {
    const effects = enhanced();
    effects.consume([{ t: 'fx', id: 'superBreak', x: 0, y: 955 }], 0);
    for (let at = 0; at < 260; at += 3) {
      const { x, y } = effects.shakeOffset(at);
      expect(Math.abs(x)).toBeLessThanOrEqual(5);
      expect(Math.abs(y)).toBeLessThanOrEqual(5);
    }
  });

  it('does not let a light bounce cut a superbounce short', () => {
    const effects = enhanced();
    effects.consume([{ t: 'fx', id: 'superBreak', x: 0, y: 955 }], 0);
    const strong = effects.shakeOffset(30);
    effects.consume([{ t: 'fx', id: 'bounceFx', x: 0, y: 955 }], 30);
    expect(effects.shakeOffset(30)).toEqual(strong);
  });

  it('shakes on a faceplant, which carries no fx cue of its own', () => {
    const effects = enhanced();
    effects.consume([{ t: 'shotDone', feet: 40, outcome: 'faceplant' }], 0);
    expect(effects.shakeOffset(20)).not.toEqual({ x: 0, y: 0 });

    const cheered = enhanced();
    cheered.consume([{ t: 'shotDone', feet: 40, outcome: 'cheer' }], 0);
    expect(cheered.shakeOffset(20)).toEqual({ x: 0, y: 0 });
  });
});
