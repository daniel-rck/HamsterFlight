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
    // A query is a pure read: asking about an earlier moment still answers.
    expect(effects.active(FRAME_MS * 2)).toHaveLength(1);
    // Only the frame's prune drops what has run out, for good.
    effects.prune(FRAME_MS * 4);
    expect(effects.active(FRAME_MS * 2)).toHaveLength(0);
  });

  it('prunes only what has finished', () => {
    const effects = new Effects({ enhanced: true });
    effects.consume([BREAK], 0);
    effects.consume([BREAK], FRAME_MS * 3);
    effects.emitSkidDust(0, 950, 0);
    effects.prune(FRAME_MS * 4);
    expect(effects.active(FRAME_MS * 4)).toHaveLength(1);
    expect(effects.particles(FRAME_MS * 4).length).toBeGreaterThan(0);
    effects.prune(10_000);
    expect(effects.active(10_000)).toHaveLength(0);
    expect(effects.particles(0)).toHaveLength(0);
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

describe('the pickup burst', () => {
  const at = { x: 400, y: 820 };

  it('resumes the clip of the collectible itself, past the item pose', () => {
    const effects = new Effects();
    effects.consume([{ t: 'pickup', kind: 'bounce' }], 1000, at);

    const active = effects.active(1000);
    expect(active).toHaveLength(1);
    // Frames 0 and 1 are the ball; `_loc3_.play()` runs the smoke from 2.
    expect(active[0]).toEqual({ sprite: 'powerup/bounce', frame: 2, x: 400, y: 820 });
  });

  it('runs the four smoke frames and stops before the blank tail', () => {
    const effects = new Effects();
    effects.consume([{ t: 'pickup', kind: 'bounce' }], 0, at);

    expect(effects.active(FRAME_MS * 1)[0]?.frame).toBe(3);
    expect(effects.active(FRAME_MS * 3.9)[0]?.frame).toBe(5);
    // Frame 6 onwards is 20 frames of nothing at all, so the clip ends here.
    expect(effects.active(FRAME_MS * 4)).toHaveLength(0);
    effects.prune(FRAME_MS * 4);
    expect(effects.active(FRAME_MS * 1)).toHaveLength(0);
  });

  it('gives the springboard its longer run', () => {
    const effects = new Effects();
    effects.consume([{ t: 'pickup', kind: 'rebound' }], 0, at);
    expect(effects.active(FRAME_MS * 6)[0]).toEqual({
      sprite: 'powerup/rebound',
      frame: 8,
      x: 400,
      y: 820,
    });
    expect(effects.active(FRAME_MS * 7)).toHaveLength(0);
  });

  it('leaves wind alone, which never played its collectible', () => {
    const effects = new Effects();
    effects.consume([{ t: 'pickup', kind: 'wind' }], 0, at);
    expect(effects.active(0)).toHaveLength(0);
  });

  it('needs a position to draw at', () => {
    const effects = new Effects();
    effects.consume([{ t: 'pickup', kind: 'speed' }], 0);
    expect(effects.active(0)).toHaveLength(0);
  });

  it('is dropped by clear(), like every other clip in flight', () => {
    const effects = new Effects();
    effects.consume([{ t: 'pickup', kind: 'slide' }], 0, at);
    effects.clear();
    expect(effects.active(0)).toHaveLength(0);
  });
});

describe('Effects with motion off', () => {
  it('keeps the enhanced presentation but nothing moves or scatters', () => {
    const effects = new Effects({ enhanced: true, motion: false });
    expect(effects.enhanced).toBe(true);
    expect(effects.motion).toBe(false);
    effects.consume([{ t: 'fx', id: 'superBreak', x: 0, y: 955 }], 0);
    effects.consume([{ t: 'pickup', kind: 'speed' }], 0, { x: 100, y: 900 });
    effects.emitSkidDust(100, 950, 0);
    expect(effects.shakeOffset(20)).toEqual({ x: 0, y: 0 });
    expect(effects.shockwave(20)).toBeNull();
    expect(effects.aberration(20)).toBe(0);
    expect(effects.particles(20)).toHaveLength(0);
    // Both clips are restoration, not motion: the impact and the pickup burst
    // are what the original drew, while the sparks above are this port's own.
    expect(effects.active(0).map(fx => fx.sprite)).toEqual(['fx/superBreak', 'powerup/speed']);
  });

  it('defaults motion to the enhanced flag', () => {
    expect(new Effects({ enhanced: true }).motion).toBe(true);
    expect(new Effects().motion).toBe(false);
  });
});

describe('Effects camera shake', () => {
  const enhanced = (): Effects => new Effects({ enhanced: true });

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

describe('Effects shockwave', () => {
  it('starts at the impact, in world coordinates, and expands', () => {
    const effects = new Effects({ enhanced: true });
    effects.consume([{ t: 'fx', id: 'superBreak', x: 1234, y: 955 }], 0);

    const early = effects.shockwave(40);
    const late = effects.shockwave(200);
    expect(early?.x).toBe(1234);
    expect(early?.y).toBe(955);
    expect(late?.progress).toBeGreaterThan(early?.progress ?? 1);
  });

  it('ends cleanly and does not come back', () => {
    const effects = new Effects({ enhanced: true });
    effects.consume([{ t: 'fx', id: 'break', x: 0, y: 955 }], 0);
    expect(effects.shockwave(259)).not.toBeNull();
    expect(effects.shockwave(260)).toBeNull();
    expect(effects.shockwave(10_000)).toBeNull();
  });

  it('scales with the impact, and a light one cannot displace a hard one', () => {
    const effects = new Effects({ enhanced: true });
    effects.consume([{ t: 'fx', id: 'bounceFx', x: 0, y: 955 }], 0);
    const light = effects.shockwave(10)?.amplitude ?? 0;
    effects.consume([{ t: 'fx', id: 'superBreak', x: 0, y: 955 }], 20);
    const hard = effects.shockwave(30)?.amplitude ?? 0;
    expect(hard).toBeGreaterThan(light);

    effects.consume([{ t: 'fx', id: 'bounceFx', x: 0, y: 955 }], 40);
    expect(effects.shockwave(50)?.amplitude).toBe(hard);
  });

  it('does not run in faithful mode - the original stage never warped', () => {
    const faithful = new Effects();
    faithful.consume([{ t: 'fx', id: 'break', x: 0, y: 955 }], 0);
    expect(faithful.shockwave(40)).toBeNull();
    expect(faithful.aberration(40)).toBe(0);
    // The impact clips are restoration, not addition, so they still play.
    expect(faithful.active(0)).toHaveLength(1);
  });
});

describe('Effects at rest', () => {
  it('reports nothing running before anything has happened', () => {
    const effects = new Effects({ enhanced: true });
    // performance.now() is small at boot; a wave keyed only on elapsed time
    // would read as live here and attach the filter for nothing.
    for (const at of [0, 1, 40, 259, 1000]) {
      expect(effects.shockwave(at)).toBeNull();
      expect(effects.aberration(at)).toBe(0);
      expect(effects.shakeOffset(at)).toEqual({ x: 0, y: 0 });
      expect(effects.active(at)).toHaveLength(0);
    }
  });
});

/** One emission interval, so each call in the cap test actually emits. */
const DUST_STEP = 50;

describe('Effects particles', () => {
  const enhanced = (): Effects => new Effects({ enhanced: true });

  it('emits nothing in faithful mode', () => {
    const effects = new Effects();
    effects.emitSkidDust(100, 950, 0);
    effects.consume([{ t: 'pickup', kind: 'speed' }], 0, { x: 100, y: 900 });
    expect(effects.particles(10)).toHaveLength(0);
  });

  it('throws skid grit backwards and lets it fall', () => {
    const effects = enhanced();
    effects.emitSkidDust(100, 950, 0);
    const born = effects.particles(0);
    expect(born.length).toBeGreaterThan(0);

    const later = effects.particles(200);
    expect(later).toHaveLength(born.length);
    // Backwards, because the hamster is sliding forwards.
    expect(later.every((p, i) => p.x < (born[i]?.x ?? 0))).toBe(true);
    expect(later.every(p => p.age > 0 && p.age < 1)).toBe(true);
  });

  it('rate-limits the skid so a long slide does not flood the field', () => {
    const effects = enhanced();
    for (let at = 0; at < 40; at += 5) effects.emitSkidDust(100, 950, at);
    // 40 ms of ticks is under one emission interval, so only the first landed.
    expect(effects.particles(1)).toHaveLength(3);
  });

  it('drops particles once they have run out', () => {
    const effects = enhanced();
    effects.emitSkidDust(100, 950, 0);
    expect(effects.particles(419).length).toBeGreaterThan(0);
    expect(effects.particles(420)).toHaveLength(0);
  });

  it('bursts sparks where the hamster was when the pickup fired', () => {
    const effects = enhanced();
    effects.consume([{ t: 'pickup', kind: 'bounce' }], 0, { x: 640, y: 800 });
    const sparks = effects.particles(0);
    expect(sparks.length).toBeGreaterThan(4);
    expect(sparks.every(p => p.x === 640 && p.y === 800)).toBe(true);
  });

  it('is deterministic, so a replay scatters them identically', () => {
    const a = enhanced();
    const b = enhanced();
    for (const effects of [a, b]) {
      effects.emitSkidDust(100, 950, 0);
      effects.consume([{ t: 'pickup', kind: 'wind' }], 60, { x: 300, y: 700 });
    }
    expect(a.particles(120)).toEqual(b.particles(120));
  });

  it('caps the field, however long the skid runs', () => {
    const effects = enhanced();
    for (let at = 0; at < 20_000; at += DUST_STEP) effects.emitSkidDust(100, 950, at);
    expect(effects.particles(19_999).length).toBeLessThanOrEqual(160);
  });
});
