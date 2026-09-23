import { describe, expect, it } from "vitest";
import { C } from "@/sim/constants.ts";
import type { SimEvent } from "@/sim/events.ts";
import {
  beginJump,
  JUMP_SFX_TICK,
  JUMP_WINDUP_TICKS,
  launchMeterValue,
  liftOff,
  stepJump,
} from "@/sim/phases/JumpPhase.ts";
import { mulberry32 } from "@/sim/rng/mulberry32.ts";

describe("jump phase", () => {
  it("plays clip 52's wind-up on the pad before the clip calls jump()", () => {
    // 26 frames at 19 fps from label `jump` (frame 2) to the frame 28 script.
    expect(JUMP_WINDUP_TICKS).toBe(28);
    const rng = mulberry32(7);
    const s = beginJump();
    const events: SimEvent[] = [];
    for (let t = 1; t < JUMP_WINDUP_TICKS; t++) {
      stepJump(s, rng, events);
      expect(s.windup).toBe(t);
      expect(s.y).toBe(C.HAMSTER_START_Y);
    }
    // snd_jump on frame 23, once.
    expect(events.filter((e) => e.t === "sfx" && e.id === "jump")).toHaveLength(1);
    expect(JUMP_SFX_TICK).toBe(23);
    stepJump(s, rng, events);
    // `this._y -= 117.8; hamsterShoot.jump()` - and no jumpFrame() yet.
    expect(s.windup).toBeNull();
    expect(s.y).toBeCloseTo(C.HAMSTER_START_Y - C.JUMP_CLIP_LIFT, 10);
    expect(s.boost).toBe(false);
  });

  it("starts with yvel in -14..-10", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = beginJump();
      liftOff(s, mulberry32(seed), []);
      expect(s.yvel).toBeGreaterThanOrEqual(-14);
      expect(s.yvel).toBeLessThanOrEqual(-10);
      expect(Number.isInteger(s.yvel)).toBe(true);
    }
  });

  it("fires the boost exactly once, on the first tick below y = 930", () => {
    const rng = mulberry32(42);
    const s = beginJump();
    liftOff(s, rng, []);
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
    const s = { windup: null, y: 800, yvel: 4, boost: true, swung: false };
    stepJump(s, mulberry32(1), []);
    expect(s.yvel).toBeCloseTo(4 + C.JUMP_GRAV_FALLING, 10);

    const rising = { windup: null, y: 800, yvel: -4, boost: true, swung: false };
    stepJump(rising, mulberry32(1), []);
    expect(rising.yvel).toBeCloseTo(-4 + C.JUMP_GRAV_RISING, 10);
  });

  it("has a seed-dependent apex, 314 to 464 px above the pad", () => {
    // From 838.2 the boost fires on the first tick, so yvel opens at -25..-33.
    // The document's "apex at y ~= 726" assumed the physics starts on the pad
    // (y = 956), which is what the port did until clip 52's frame 28 script
    // turned up; its whole range now sits above that figure.
    const apexes: number[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const rng = mulberry32(seed);
      const s = beginJump();
      let apex = s.y;
      for (let t = 0; t < 120; t++) {
        if (stepJump(s, rng, [])) break;
        if (s.y < apex) apex = s.y;
      }
      apexes.push(apex);
    }
    const min = Math.min(...apexes);
    const max = Math.max(...apexes);
    expect(min).toBeGreaterThan(480);
    expect(max).toBeLessThan(650);
    expect(max - min).toBeGreaterThan(100);
    expect(max).toBeLessThan(726);
  });

  it("lands back on the pad if the window is missed", () => {
    const rng = mulberry32(3);
    const s = beginJump();
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
