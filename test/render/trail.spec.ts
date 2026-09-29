import { describe, expect, it } from "vitest";
import { Effects } from "@/render/effects/Effects.ts";
import { TRAIL, trailSegments, trailStrength } from "@/render/scene/trail.ts";
import type { SimEvent } from "@/sim/events.ts";

const head = { x: 100, y: 50 };
const past = [
  { x: 80, y: 52 },
  { x: 60, y: 56 },
  { x: 40, y: 62 },
];

describe("trailStrength", () => {
  it("is nothing while slow, full when fast, and never outside 0 to 1", () => {
    expect(trailStrength(0)).toBe(0);
    expect(trailStrength(TRAIL.speedFrom)).toBe(0);
    expect(trailStrength(TRAIL.speedFrom + TRAIL.speedSpan)).toBe(1);
    expect(trailStrength(1000)).toBe(1);
    expect(trailStrength(TRAIL.speedFrom + TRAIL.speedSpan / 2)).toBeCloseTo(0.5, 6);
  });
});

describe("trailSegments", () => {
  it("runs from the head back along the past, thinner and fainter each step", () => {
    const segments = trailSegments(head, past, 1);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ x0: 100, y0: 50, x1: 80, y1: 52 });
    // Each segment starts where the last one ended.
    expect(segments[1]).toMatchObject({ x0: 80, y0: 52, x1: 60, y1: 56 });
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]?.width).toBeLessThan(segments[i - 1]?.width ?? 0);
      expect(segments[i]?.alpha).toBeLessThan(segments[i - 1]?.alpha ?? 0);
    }
    expect(segments[0]?.width).toBeLessThan(TRAIL.width);
    expect(segments[0]?.alpha).toBeLessThan(TRAIL.alpha);
  });

  it("scales with the strength and is empty at zero", () => {
    const full = trailSegments(head, past, 1);
    const half = trailSegments(head, past, 0.5);
    expect(half[0]?.width).toBeCloseTo((full[0]?.width ?? 0) / 2, 6);
    expect(half[0]?.alpha).toBeCloseTo((full[0]?.alpha ?? 0) / 2, 6);
    expect(trailSegments(head, past, 0)).toEqual([]);
  });

  it("leaves out a segment that goes nowhere", () => {
    expect(trailSegments(head, [head, { x: 80, y: 52 }], 1)).toHaveLength(1);
    expect(trailSegments(head, [], 1)).toEqual([]);
  });
});

describe("Effects trail", () => {
  const fly = (effects: Effects, ticks: number, speed = 30): void => {
    for (let i = 0; i < ticks; i++) effects.noteFlight(i * 20, 100 - i, speed, 0);
  };

  it("needs a few ticks of flight before there is anything to draw", () => {
    const effects = new Effects();
    expect(effects.trail(head)).toEqual([]);
    fly(effects, 1);
    expect(effects.trail(head)).toEqual([]);
    fly(effects, 3);
    expect(effects.trail(head).length).toBeGreaterThan(0);
  });

  it("leaves out the newest point, which the interpolated head has not reached", () => {
    const effects = new Effects();
    fly(effects, 4);
    // Recorded: (0,100) (20,99) (40,98) (60,97); newest is (60,97).
    const first = effects.trail({ x: 50, y: 97.5 })[0];
    expect(first).toMatchObject({ x0: 50, y0: 97.5, x1: 40, y1: 98 });
  });

  it("keeps only the last few ticks", () => {
    const effects = new Effects();
    fly(effects, 50);
    expect(effects.trail(head).length).toBeLessThanOrEqual(TRAIL.ticks);
  });

  it("is faint while slow and gone once the flight ends", () => {
    const effects = new Effects();
    fly(effects, 6, 3);
    expect(effects.trail(head)).toEqual([]);
    fly(effects, 6, 40);
    expect(effects.trail(head).length).toBeGreaterThan(0);
    effects.endFlight();
    expect(effects.trail(head)).toEqual([]);
  });

  it("honours reduced motion, including what is already drawn", () => {
    const effects = new Effects({ motion: false });
    fly(effects, 6);
    expect(effects.trail(head)).toEqual([]);

    const live = new Effects();
    fly(live, 6);
    expect(live.trail(head).length).toBeGreaterThan(0);
    live.motion = false;
    expect(live.trail(head)).toEqual([]);
  });

  it("is a record of ticks, so the same flight always gives the same streak", () => {
    const a = new Effects();
    const b = new Effects();
    fly(a, 8);
    fly(b, 8);
    expect(a.trail(head)).toEqual(b.trail(head));
    a.clear();
    expect(a.trail(head)).toEqual([]);
  });
});

describe("impact dust", () => {
  const hit = (id: "bounceFx" | "break" | "superBreak"): SimEvent => ({
    t: "fx",
    id,
    x: 200,
    y: 950,
  });

  it("is thrown up at the impact, more of it the harder the hit", () => {
    const counts = (["bounceFx", "break", "superBreak"] as const).map((id) => {
      const effects = new Effects();
      effects.consume([hit(id)], 0);
      return effects.particles(0).length;
    });
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBeGreaterThan(counts[0] ?? 0);
    expect(counts[2]).toBeGreaterThan(counts[1] ?? 0);
  });

  it("goes out to both sides, dust rather than glow", () => {
    const effects = new Effects();
    effects.consume([hit("superBreak")], 0);
    const later = effects.particles(200);
    expect(later.some((p) => p.x < 200)).toBe(true);
    expect(later.some((p) => p.x > 200)).toBe(true);
    expect(later.every((p) => !p.glow)).toBe(true);
  });

  it("stays out under reduced motion", () => {
    const effects = new Effects({ motion: false });
    effects.consume([hit("superBreak")], 0);
    expect(effects.particles(0)).toEqual([]);
  });

  it("lets pickup sparks glow", () => {
    const effects = new Effects();
    effects.consume([{ t: "pickup", kind: "speed" }], 0, { x: 10, y: 10 });
    const sparks = effects.particles(0);
    expect(sparks.length).toBeGreaterThan(0);
    expect(sparks.every((p) => p.glow)).toBe(true);
  });
});
