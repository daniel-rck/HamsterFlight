import { describe, expect, it } from "vitest";
import { C } from "@/sim/constants.ts";
import { Projectile } from "@/sim/entities/Projectile.ts";
import { type Box, overlaps, rotateBox } from "@/sim/math/aabb.ts";
import { degToRad, PI_AS2, radToDeg } from "@/sim/math/angles.ts";
import { mulberry32 } from "@/sim/rng/mulberry32.ts";
import { cullPowerups } from "@/sim/systems/PowerupSpawner.ts";
import { makeFlight } from "../support/harness.ts";

describe("overlaps", () => {
  const unit: Box = { hw: 5, hh: 5, cx: 0, cy: 0 };

  it("counts touching edges as a hit, like Flash hitTest", () => {
    expect(overlaps(0, 0, unit, 10, 0, unit)).toBe(true);
    expect(overlaps(0, 0, unit, 10.001, 0, unit)).toBe(false);
    expect(overlaps(0, 0, unit, 0, 10, unit)).toBe(true);
    expect(overlaps(0, 0, unit, 7, 7, unit)).toBe(true);
    expect(overlaps(0, 0, unit, 7, 11, unit)).toBe(false);
  });

  it("applies each box’s centre offset before comparing", () => {
    const shifted: Box = { hw: 5, hh: 5, cx: 20, cy: 0 };
    expect(overlaps(0, 0, shifted, 0, 0, unit)).toBe(false);
    expect(overlaps(0, 0, shifted, 20, 0, unit)).toBe(true);
  });
});

describe("rotateBox", () => {
  const tall: Box = { hw: 2, hh: 5, cx: 1, cy: 3 };

  it("leaves the box alone at 0 and 180, lays it on its side at 90", () => {
    const at0 = rotateBox(tall, 0);
    expect([at0.hw, at0.hh, at0.cx, at0.cy]).toEqual([2, 5, 1, 3]);
    const at90 = rotateBox(tall, 90);
    expect(at90.hw).toBeCloseTo(5, 12);
    expect(at90.hh).toBeCloseTo(2, 12);
    // The centre offset turns with the clip: (1, 3) -> (-3, 1).
    expect(at90.cx).toBeCloseTo(-3, 12);
    expect(at90.cy).toBeCloseTo(1, 12);
    const at180 = rotateBox(tall, 180);
    expect(at180.hw).toBeCloseTo(2, 12);
    expect(at180.cx).toBeCloseTo(-1, 12);
  });

  it("bounds the turned rectangle's corners at 45 degrees", () => {
    const at45 = rotateBox(tall, 45);
    const r = Math.SQRT1_2;
    expect(at45.hw).toBeCloseTo((2 + 5) * r, 12);
    expect(at45.hh).toBeCloseTo((2 + 5) * r, 12);
  });
});

describe("angles", () => {
  it("round-trips through the original’s truncated pi", () => {
    expect(radToDeg(PI_AS2)).toBe(180);
    expect(degToRad(180)).toBe(PI_AS2);
    expect(degToRad(radToDeg(1.234))).toBeCloseTo(1.234, 12);
    // Not Math.PI: the difference is what the golden angles depend on.
    expect(radToDeg(Math.PI)).not.toBe(180);
  });
});

describe("mulberry32", () => {
  it("is reproducible from its seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a.float()).toBe(b.float());
  });

  it("keeps int(n) inside [0, n) with every value reachable", () => {
    const rng = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(11);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(11);
      seen.add(v);
    }
    expect(seen.size).toBe(11);
  });

  it("forks into streams that differ from each other and from the master", () => {
    const master = mulberry32(99);
    const jump = master.fork("jump");
    const powerups = master.fork("powerups");
    const first = (rng: ReturnType<typeof mulberry32>) =>
      Array.from({ length: 8 }, () => rng.int(1000));
    const j = first(jump);
    expect(j).not.toEqual(first(powerups));
    expect(j).not.toEqual(first(master));
    // Stable across runs, so goldens can depend on it.
    expect(first(mulberry32(99).fork("jump"))).toEqual(j);
  });
});

describe("Projectile", () => {
  it("captures ox/oy before moving, so they trail by one integration", () => {
    const p = new Projectile(100, 700, 0, 0, C.GRAV);
    p.xvel = 10;
    p.yvel = 5;
    p.integrate();
    expect([p.ox, p.oy]).toEqual([100, 700]);
    expect([p.x, p.y]).toEqual([110, 705]);
    p.integrate();
    expect([p.ox, p.oy]).toEqual([110, 705]);
    expect([p.x, p.y]).toEqual([120, 710]);
  });

  it("turns the clip to its velocity before moving, plus the original's quarter turn", () => {
    // Bullet.as:44-50.
    const p = new Projectile(100, 700, 0, 0, C.GRAV);
    p.xvel = 20;
    p.yvel = -10;
    p.integrate();
    expect(p.rotationDeg).toBe(radToDeg(Math.atan2(-10, 20)) + 90);

    // Under 7 px/tick and below y = 940 the clip stands at 90 - the signed xvel.
    const crawling = new Projectile(100, 945, 0, 0, C.GRAV);
    crawling.xvel = 5;
    crawling.integrate();
    expect(crawling.rotationDeg).toBe(90);
    const fast = new Projectile(100, 945, 0, 0, C.GRAV);
    fast.xvel = 30;
    fast.yvel = 1;
    fast.integrate();
    expect(fast.rotationDeg).not.toBe(90);

    // The test reads the pre-move y: 939 -> 949 still rotates.
    const dropping = new Projectile(100, 939, 0, 0, C.GRAV);
    dropping.xvel = 5;
    dropping.yvel = 10;
    dropping.integrate();
    expect(dropping.y).toBe(949);
    expect(dropping.rotationDeg).toBe(radToDeg(Math.atan2(10, 5)) + 90);

    const off = new Projectile(100, 700, 0, 0, C.GRAV);
    off.xvel = 20;
    off.yvel = -10;
    off.doRotation = false;
    off.integrate();
    expect(off.rotationDeg).toBe(90);
  });

  it("starts at setClipPos()'s radians-as-degrees rotation", () => {
    // Bullet.as:79 - `_rotation = this.ang`, the launch angle in radians.
    expect(new Projectile(0, 0, 50, 1.2, C.GRAV).rotationDeg).toBe(1.2);
  });

  it("launches with sin/-cos of the angle, and the glide lift ignores its argument", () => {
    const p = new Projectile(0, 0, 50, PI_AS2 / 2, C.GRAV);
    expect(p.xvel).toBeCloseTo(50, 5);
    // Not exactly zero: PI_AS2 / 2 is a hair short of a right angle.
    expect(p.yvel).toBeCloseTo(0, 4);
    p.setGlideGravity();
    expect(p.grav).toBeCloseTo(C.GLIDE_FACTOR * p.xvel, 12);
    p.restoreGravity();
    expect(p.grav).toBe(C.GRAV);
  });
});

describe("cullPowerups", () => {
  it("drops items from the front once they are well off the left edge", () => {
    const s = makeFlight({ x: 2000 });
    s.camera.x = -2000 + C.CAM_ANCHOR_X;
    for (const x of [500, 1500, 2600]) {
      s.powerups.push({ kind: "speed", x, y: 700, taken: false, activeTicksLeft: 0 });
    }
    cullPowerups(s);
    // Screen x = camera.x + x; anything under the cull line goes, in order.
    expect(s.powerups.map((it) => it.x)).toEqual([2600]);
  });

  it("never skips an entry on a culling tick, unlike the original", () => {
    const s = makeFlight({ x: 5000 });
    s.camera.x = -5000 + C.CAM_ANCHOR_X;
    for (const x of [100, 200, 300, 400]) {
      s.powerups.push({ kind: "wind", x, y: 700, taken: false, activeTicksLeft: 0 });
    }
    cullPowerups(s);
    expect(s.powerups).toHaveLength(0);
  });
});
