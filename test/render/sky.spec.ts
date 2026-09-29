import { describe, expect, it } from "vitest";
import {
  CLOUD_LAYER,
  CLOUD_SHADE,
  CLOUD_SHADE_DROP,
  cloudAlpha,
  cloudColours,
  clouds,
  GROUND,
  GROUND_BANDS,
  HILL_LAYERS,
  HILL_SINK,
  HILL_TILE,
  horizonGlowAlpha,
  horizonY,
  STAR_LAYERS,
  skyColours,
  starAt,
  starField,
  starOffset,
  TUFT_TILE,
  tileOrigins,
  tuftBlades,
  tufts,
  wrap,
  worldTileOrigins,
  hillColour,
  hillProfile,
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

describe("the hills", () => {
  it("join themselves, so repeating a tile leaves no seam", () => {
    for (const layer of HILL_LAYERS) {
      const profile = hillProfile(layer);
      // The ridge starts and ends at the same height; the last four numbers close the base.
      expect(profile[1]).toBeCloseTo(profile[profile.length - 5] ?? NaN, 6);
      expect(profile[profile.length - 6]).toBe(HILL_TILE);
      for (let i = 1; i < profile.length - 4; i += 2) {
        expect(profile[i]).toBeLessThan(0);
        expect(profile[i]).toBeGreaterThanOrEqual(-layer.height);
      }
      expect(profile[profile.length - 3]).toBe(HILL_SINK);
    }
  });

  it("cover the view with two tiles wherever the camera is", () => {
    for (const layer of HILL_LAYERS) {
      for (const x of [0, -1, -777.7, -123_456.7, 5000]) {
        const [a, b] = tileOrigins(x, layer.parallax, HILL_TILE);
        expect(a).toBeLessThanOrEqual(0);
        expect(b).toBe(a + HILL_TILE);
        expect(b + HILL_TILE).toBeGreaterThanOrEqual(C.VIEW_W);
      }
    }
  });

  it("drift left with the camera, the far plane slower", () => {
    for (const layer of HILL_LAYERS) {
      const before = tileOrigins(0, layer.parallax, HILL_TILE)[0];
      const after = tileOrigins(-300, layer.parallax, HILL_TILE)[0];
      // 300 px of flight moves the tile by parallax * 300 to the left, modulo the tile.
      expect(wrap(before - after, HILL_TILE)).toBeCloseTo(300 * layer.parallax, 6);
    }
    const parallax = HILL_LAYERS.map((l) => l.parallax);
    expect(parallax).toEqual([...parallax].sort((a, b) => a - b));
  });

  it("haze towards the sky behind them, the far plane more", () => {
    const sky = skyColours(0);
    const gap = (colour: readonly number[]) =>
      colour.reduce((sum, v, i) => sum + Math.abs(v - (sky.bottom[i] ?? 0)), 0);
    const gaps = HILL_LAYERS.map((l) => gap(hillColour(l, sky)));
    for (const [i, layer] of HILL_LAYERS.entries()) {
      expect(gaps[i]).toBeLessThan(gap(layer.colour));
    }
    // Later layers are nearer, so they haze less and sit further from the sky colour.
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
    // Up in the dark the hills darken with the sky.
    for (const layer of HILL_LAYERS) {
      expect(hillColour(layer, skyColours(1))).not.toEqual(hillColour(layer, sky));
    }
  });

  it("stand on the horizon, which is the grass edge and leaves with the ground", () => {
    expect(horizonY(REST)).toBe(GROUND.y + C.CAM_Y_CLAMP);
    expect(horizonY({ x: 0, y: REST.y + 500 })).toBe(horizonY(REST) + 500);
  });
});

describe("the horizon glow", () => {
  it("is full by day and gone as the stars come in", () => {
    expect(horizonGlowAlpha(0)).toBeGreaterThan(0);
    expect(horizonGlowAlpha(0.2)).toBeLessThan(horizonGlowAlpha(0));
    expect(horizonGlowAlpha(0.35)).toBe(0);
    expect(horizonGlowAlpha(1)).toBe(0);
  });
});

describe("the ground", () => {
  it("has bands that step down from the lip to the bottom of the slab", () => {
    let last = 0;
    for (const band of GROUND_BANDS) {
      expect(band.dy).toBeGreaterThanOrEqual(last);
      last = band.dy;
    }
    expect(last).toBeLessThan(GROUND.height);
  });

  it("stands its tufts inside one tile, and two tiles cover the view", () => {
    for (const tuft of tufts()) {
      expect(tuft.x).toBeGreaterThanOrEqual(0);
      expect(tuft.x + tuft.w).toBeLessThan(TUFT_TILE + 8);
      for (const blade of tuftBlades(tuft)) expect(blade).toHaveLength(6);
    }
    for (const x of [0, -1, -599.5, -600, -123_456.7]) {
      const [a, b] = worldTileOrigins(x, TUFT_TILE);
      expect(a).toBeLessThanOrEqual(-x);
      expect(b).toBe(a + TUFT_TILE);
      expect(b + TUFT_TILE).toBeGreaterThanOrEqual(-x + C.VIEW_W);
    }
  });
});
