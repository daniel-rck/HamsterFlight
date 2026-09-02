import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bestShot, type HoldPolicy, hold, mash, median, never, smart } from "../support/harness.ts";

/**
 * The successor to the strategy table in the reverse-engineering document
 * (section 12). Those numbers came from `reference/legacy/sim.js`, which
 * diverges from the bytecode in three ways - tick order, impact angle and the
 * frozen glide lift - so they are NOT usable as expected values. See
 * reference/doc/porting-notes.md.
 *
 * What is asserted here instead is the qualitative shape the document and the
 * game's own help text both describe, which a faithful port must reproduce:
 * holding the button flies high but not far, measured holding flies far.
 */
const SEEDS = Array.from({ length: 120 }, (_, i) => 0x5eed_0000 + i);

interface Stats {
  readonly median: number;
  readonly max: number;
  readonly peakMedian: number;
  readonly landed: number;
  readonly truncated: number;
}

function run(policy: HoldPolicy): Stats {
  const feet: number[] = [];
  const peaks: number[] = [];
  let truncated = 0;
  for (const seed of SEEDS) {
    const best = bestShot(seed, policy);
    if (best === null) continue;
    feet.push(best.feet);
    peaks.push(best.peakUp);
    if (best.truncated) truncated++;
  }
  return {
    median: median(feet),
    max: feet.reduce((a, b) => Math.max(a, b), 0),
    peakMedian: median(peaks),
    landed: feet.length,
    truncated,
  };
}

describe("strategy behaviour", () => {
  // ~10 000 full shots: computed once, inside the lifecycle rather than at
  // collection time, so a hang is attributed to this file's setup.
  let noHold: Stats;
  let holding: Stats;
  let mashing: Stats;
  let measured: Stats;

  beforeAll(() => {
    noHold = run(never);
    holding = run(hold);
    mashing = run(mash);
    measured = run(smart);
  });

  afterAll(() => {
    const row = (name: string, s: Stats) =>
      `${name.padEnd(9)} median ${String(s.median).padStart(5)} ft   max ${String(s.max).padStart(6)} ft   peak ${String(s.peakMedian).padStart(6)} px`;
    console.info(
      [
        "",
        row("never", noHold),
        row("hold", holding),
        row("mash", mashing),
        row("measured", measured),
      ].join("\n"),
    );
  });

  it("lands a shot for most seeds, and every shot ends", () => {
    expect(noHold.landed).toBeGreaterThan(SEEDS.length * 0.5);
    for (const s of [noHold, holding, mashing, measured]) expect(s.truncated).toBe(0);
  });

  it("gliding beats not gliding", () => {
    expect(measured.median).toBeGreaterThan(noHold.median);
  });

  it("holding continuously flies higher than it flies far", () => {
    // The glide lift scales with xvel while drag eats xvel every tick, so
    // holding continuously climbs but does not travel.
    expect(holding.peakMedian).toBeGreaterThan(measured.peakMedian);
    expect(holding.median).toBeLessThan(measured.median);
  });

  it("mashing buys less lift than holding", () => {
    // Half the ticks under lift, and the meter regenerates on the other half.
    expect(mashing.peakMedian).toBeLessThan(holding.peakMedian);
    expect(mashing.peakMedian).toBeGreaterThan(noHold.peakMedian);
  });

  it("measured holding produces a long tail", () => {
    expect(measured.max).toBeGreaterThan(measured.median * 2);
  });
});
