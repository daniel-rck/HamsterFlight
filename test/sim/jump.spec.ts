import { describe, expect, it } from "vitest";
import { C } from "@/sim/constants.ts";
import { beginJump, launchMeterValue, stepJump } from "@/sim/phases/JumpPhase.ts";
import { mulberry32 } from "@/sim/rng/mulberry32.ts";

describe("jump phase", () => {
  it("starts with yvel in -14..-10", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { yvel } = beginJump(mulberry32(seed));
      expect(yvel).toBeGreaterThanOrEqual(-14);
      expect(yvel).toBeLessThanOrEqual(-10);
      expect(Number.isInteger(yvel)).toBe(true);
    }
  });

  it("fires the boost exactly once, on the first tick below y = 930", () => {
    const rng = mulberry32(42);
    const s = beginJump(rng);
    let boostTicks = 0;
    let boostedFrom: number | null = null;
    for (let t = 0; t < 30; t++) {
      const before = s.y;
      const yvelBefore = s.yvel;
      if (stepJump(s, rng, [])) break;
      // A jump of more than the gravity step means the boost fired.
      const delta = s.yvel - yvelBefore;
      if (delta < -1) {
        boostTicks++;
        boostedFrom = before;
      }
    }
    expect(boostTicks).toBe(1);
    expect(s.boost).toBe(true);
    // Tested against the position *before* the move, so the firing tick
    // started above the threshold.
    expect(boostedFrom).not.toBeNull();
    expect(boostedFrom ?? 0).toBeLessThan(C.JUMP_BOOST_Y);
  });

  it("uses asymmetric gravity: 1.5 rising, 0.75 falling", () => {
    // Past the boost window and already falling, so only the 0.75 term applies.
    const s = { y: 800, yvel: 4, boost: true, swung: false };
    stepJump(s, mulberry32(1), []);
    expect(s.yvel).toBeCloseTo(4 + C.JUMP_GRAV_FALLING, 10);

    const rising = { y: 800, yvel: -4, boost: true, swung: false };
    stepJump(rising, mulberry32(1), []);
    expect(rising.yvel).toBeCloseTo(-4 + C.JUMP_GRAV_RISING, 10);
  });

  it("has a seed-dependent apex spanning roughly 170 px", () => {
    // The document quotes "apex at y ~= 726". That is a mid-range figure, not a
    // bound: yvel starts in -14..-10 and the boost adds -19..-15, so the reachable
    // apex spans about 660 (best rolls) to 840 (worst). Asserted as a range so a
    // physics change that collapses the spread is caught.
    const apexes: number[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const rng = mulberry32(seed);
      const s = beginJump(rng);
      let apex = s.y;
      for (let t = 0; t < 80; t++) {
        if (stepJump(s, rng, [])) break;
        if (s.y < apex) apex = s.y;
      }
      apexes.push(apex);
    }
    const min = Math.min(...apexes);
    const max = Math.max(...apexes);
    expect(min).toBeGreaterThan(640);
    expect(max).toBeLessThan(860);
    expect(max - min).toBeGreaterThan(100);
    // The document's figure sits inside the measured range.
    expect(min).toBeLessThan(726);
    expect(max).toBeGreaterThan(726);
  });

  it("lands back on the pad if the window is missed", () => {
    const rng = mulberry32(3);
    const s = beginJump(rng);
    let landed = false;
    for (let t = 0; t < 200; t++) {
      if (stepJump(s, rng, [])) {
        landed = true;
        break;
      }
    }
    expect(landed).toBe(true);
    expect(s.y).toBe(C.HAMSTER_START_Y);
  });

  it("clamps the launch meter to 10..100", () => {
    expect(launchMeterValue(600)).toBe(10);
    expect(launchMeterValue(956)).toBe(100);
    expect(launchMeterValue(715)).toBeCloseTo(48, 10);
  });
});
