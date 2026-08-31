import { describe, expect, it } from 'vitest';
import { mash, never, runFullShot, smart } from '../support/harness.ts';

/**
 * The successor to the strategy table in the reverse-engineering document
 * (section 12). Those numbers came from `reference/legacy/sim.js`, which
 * diverges from the bytecode in three ways - tick order, impact angle and the
 * frozen glide lift - so they are NOT usable as expected values. See
 * reference/doc/porting-notes.md.
 *
 * What is asserted here instead is the qualitative shape the document and the
 * game's own help text both describe, which a faithful port must reproduce:
 * mashing the button flies high but not far, measured holding flies far.
 */
const SEEDS = Array.from({ length: 120 }, (_, i) => 0x5eed_0000 + i);

interface Stats {
  readonly median: number;
  readonly max: number;
  readonly peakMedian: number;
  readonly landed: number;
}

function run(hold: Parameters<typeof runFullShot>[0]['hold']): Stats {
  const feet: number[] = [];
  const peaks: number[] = [];
  for (const seed of SEEDS) {
    // Click windows that actually connect vary by seed, so sweep and take the
    // best connecting shot - that is what a competent player does.
    let best = -1;
    let bestPeak = 0;
    for (let clickTick = 3; clickTick <= 26; clickTick++) {
      const r = runFullShot({ seed, clickTick, ...(hold ? { hold } : {}) });
      if (r.outcome === 'miss') continue;
      if (r.feet > best) {
        best = r.feet;
        bestPeak = r.peakUp;
      }
    }
    if (best >= 0) {
      feet.push(best);
      peaks.push(bestPeak);
    }
  }
  feet.sort((a, b) => a - b);
  peaks.sort((a, b) => a - b);
  return {
    median: feet[feet.length >> 1] ?? Number.NaN,
    max: feet.at(-1) ?? Number.NaN,
    peakMedian: peaks[peaks.length >> 1] ?? Number.NaN,
    landed: feet.length,
  };
}

describe('strategy behaviour', () => {
  const noHold = run(never);
  const mashing = run(mash);
  const measured = run(smart);

  it('lands a shot for most seeds', () => {
    expect(noHold.landed).toBeGreaterThan(SEEDS.length * 0.5);
  });

  it('gliding beats not gliding', () => {
    expect(measured.median).toBeGreaterThan(noHold.median);
  });

  it('mashing flies higher than it flies far', () => {
    // The glide lift scales with xvel while drag eats xvel every tick, so
    // holding continuously climbs but does not travel.
    expect(mashing.peakMedian).toBeGreaterThan(measured.peakMedian);
    expect(mashing.median).toBeLessThan(measured.median);
  });

  it('measured holding produces a long tail', () => {
    expect(measured.max).toBeGreaterThan(measured.median * 2);
  });

  it('reports the table for the record', () => {
    const row = (name: string, s: Stats) =>
      `${name.padEnd(9)} median ${String(s.median).padStart(5)} ft   max ${String(s.max).padStart(6)} ft   peak ${String(s.peakMedian).padStart(6)} px`;
    console.info(
      ['', row('never', noHold), row('mash', mashing), row('measured', measured)].join('\n'),
    );
    expect(noHold.median).toBeGreaterThanOrEqual(0);
  });
});
