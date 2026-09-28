import { describe, expect, it } from "vitest";
import {
  CLOUD_LAYER,
  CLOUD_SHADE,
  CLOUD_SHADE_DROP,
  cloudAlpha,
  cloudColours,
  clouds,
  GROUND,
  STAR_LAYERS,
  skyColours,
  starAt,
  starField,
  starOffset,
  wrap,
} from "@/render/scene/decor.ts";
import { C } from "@/sim/constants.ts";

const REST = { x: 0, y: C.CAM_Y_CLAMP };

describe("the star layers", () => {
  it("drift left as the hamster flies right, the near layers faster", () => {
    // 1000 px of flight to the right: the world shifts left by 1000.
    const moved = { x: -1000, y: REST.y };
    const drift = STAR_LAYERS.map((l) => wrap(-starOffset(moved, l.parallax).x, C.VIEW_W));
    for (const [i, layer] of STAR_LAYERS.entries()) {
      expect(drift[i]).toBeCloseTo(1000 * layer.parallax, 6);
    }
    expect(drift[0]).toBeLessThan(drift[1] ?? 0);
    expect(drift[1]).toBeLessThan(drift[2] ?? 0);
  });

  it("drift down as it climbs", () => {
    const high = { x: 0, y: REST.y + 500 };
    const near = STAR_LAYERS[2].parallax;
    const before = starOffset(REST, near).y;
    expect(wrap(starOffset(high, near).y - before, C.VIEW_H)).toBeCloseTo(500 * near, 6);
  });

  it("keep every star on screen however far the camera has gone", () => {
    const field = starField(1);
    expect(new Set(field.map((s) => s.layer))).toEqual(new Set([0, 1, 2]));
    for (const camera of [REST, { x: -123_456.7, y: 4321.5 }, { x: 99, y: -9999 }]) {
      for (const star of field) {
        const at = starAt(star, camera);
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.x).toBeLessThan(C.VIEW_W);
        expect(at.y).toBeGreaterThanOrEqual(0);
        expect(at.y).toBeLessThan(C.VIEW_H);
      }
    }
  });
});

describe("the cloud layer", () => {
  it("is stable for a camera position, with no state behind it", () => {
    const camera = { x: -4000, y: REST.y + 300 };
    expect(clouds(camera, 1)).toEqual(clouds(camera, 1));
    expect(clouds(REST, 1).length).toBeGreaterThan(0);
  });

  it("slides at its parallax, slower than the world", () => {
    const a = clouds({ x: -4000, y: REST.y }, 1);
    const b = clouds({ x: -4100, y: REST.y }, 1);
    // The same clouds, 100 px of flight later, 45 px further left.
    const shift = CLOUD_LAYER.parallax * 100;
    const moved = b.filter((cb) =>
      a.some((ca) => ca.shape === cb.shape && Math.abs(ca.x - shift - cb.x) < 1e-6),
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  it("stays clear of the ground at rest and is gone high up", () => {
    // The grass's edge, not the collision line below it.
    const grassOnScreen = GROUND.y + C.CAM_Y_CLAMP;
    for (const cloud of clouds(REST, 1)) {
      // The anchor is the base of the lit outline; the shade hangs a little lower.
      expect(cloud.y + CLOUD_SHADE_DROP * cloud.scale).toBeLessThan(grassOnScreen - 16);
    }
    expect(clouds({ x: 0, y: REST.y + 6000 }, 1)).toEqual([]);
  });

  it("fades into the sky as the stars come in, without going see-through", () => {
    expect(cloudAlpha(skyColours(0))).toBe(1);
    expect(cloudAlpha(skyColours(1))).toBe(0);
    expect(cloudColours(skyColours(0), 100).lit).toEqual([255, 255, 255]);
    const night = skyColours(1);
    expect(cloudColours(night, 0).lit).toEqual(night.top);
    // The underside is the lit colour times the shade, as a WebGL tint makes it.
    const { lit, shade } = cloudColours(skyColours(0.2), 200);
    expect(shade).toEqual(lit.map((v, i) => Math.round((v * (CLOUD_SHADE[i] ?? 0)) / 255)));
  });
});
