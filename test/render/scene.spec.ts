import { describe, expect, it } from "vitest";
import { SPRITES } from "@/assets/sprites.generated.ts";
import { interpolate } from "@/render/interpolate.ts";
import {
  altitudeOf,
  BUSH_SPACING,
  BUSHES,
  bushes,
  markers,
  POWERUP_IDLE_FRAME,
  POWERUP_SPRITE,
  STAR_COUNT,
  shadowScale,
  skyColours,
  starField,
} from "@/render/scene/decor.ts";
import { debugLines, glideFill, panelLines, promptFor, totalFeet } from "@/render/scene/hud.ts";
import { hamsterRotation, outcomeOffsetY, poseFor } from "@/render/scene/pose.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { noEffects, type ShotOutcome } from "@/sim/types.ts";

/**
 * Both renderers draw from these functions, so this is the parity test: what
 * used to be two hand-synchronised copies is now one definition with a spec.
 */
function flying(over: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    tick: 10,
    phaseKind: "flying",
    turn: 2,
    paused: false,
    hamster: { x: 800, y: 700, xvel: 20, yvel: -10, visible: true, doRotation: true },
    camera: { x: -650, y: -600 },
    powerups: [],
    glidePoints: 60,
    flags: noEffects(),
    shots: [120, 45],
    feet: 8,
    outcome: null,
    ...over,
  };
}

describe("pose", () => {
  it("follows the original visibility precedence", () => {
    const with_ = (flags: Partial<ReturnType<typeof noEffects>>) =>
      poseFor(flying({ flags: { ...noEffects(), ...flags } }));
    expect(with_({})).toBe("hamster/fly");
    expect(with_({ wind: true })).toBe("hamster/wind");
    expect(with_({ speed: true, wind: true })).toBe("hamster/blur");
    expect(with_({ glide: true, speed: true })).toBe("hamster/glide");
    expect(with_({ falling: true, glide: true })).toBe("hamster/drop");
    expect(with_({ bounce: true, falling: true })).toBe("hamster/ball");
    expect(with_({ superbounce: true })).toBe("hamster/ball");
    expect(with_({ skidding: true, bounce: true })).toBe("hamster/skid");
    expect(with_({ skidding: true, slide: true })).toBe("hamster/slide");
    expect(with_({ slide: true })).toBe("hamster/fly"); // slide alone is not a pose
  });

  it("shows the jump clip before launch and the outcome clip after", () => {
    expect(poseFor(flying({ phaseKind: "ready" }))).toBe("hamster/jump");
    expect(poseFor(flying({ phaseKind: "jumping" }))).toBe("hamster/jump");
    expect(poseFor(flying({ phaseKind: "settling", outcome: "cheer" }))).toBe("hit/cheer");
    expect(poseFor(flying({ phaseKind: "settling", outcome: "hole" }))).toBe("hit/hole");
    expect(poseFor(flying({ phaseKind: "settling", outcome: "zero" }))).toBe("hit/zero");
    expect(poseFor(flying({ phaseKind: "settling", outcome: "faceplant" }))).toBe("hit/faceplant");
  });

  it("drops the faceplant clip 3 px, and nothing else", () => {
    const at = (phaseKind: "flying" | "settling", outcome: ShotOutcome | null) =>
      outcomeOffsetY(flying({ phaseKind, outcome }));
    expect(at("settling", "faceplant")).toBe(3);
    expect(at("settling", "cheer")).toBe(0);
    expect(at("settling", "hole")).toBe(0);
    // Only `createHitClip` gets the offset, so a shot still in the air does not.
    expect(at("flying", "faceplant")).toBe(0);
  });

  it("turns the sprite to its velocity, except crawling along the ground", () => {
    expect(hamsterRotation(flying())).toBeCloseTo(Math.atan2(-10, 20), 12);
    // Bullet.as:46 - under 7 px/tick and below y = 940 the clip stands up.
    const crawling = flying({ hamster: { ...flying().hamster, xvel: 5, y: 945 } });
    expect(hamsterRotation(crawling)).toBe(0);
    const lowButFast = flying({ hamster: { ...flying().hamster, xvel: 30, y: 945 } });
    expect(hamsterRotation(lowButFast)).not.toBe(0);
    const slowButHigh = flying({ hamster: { ...flying().hamster, xvel: 5, y: 700 } });
    expect(hamsterRotation(slowButHigh)).not.toBe(0);
    expect(hamsterRotation(flying({ hamster: { ...flying().hamster, doRotation: false } }))).toBe(
      0,
    );
    expect(hamsterRotation(flying({ phaseKind: "jumping" }))).toBe(0);
  });
});

describe("sky", () => {
  it("is day on the ground and space at the backdrop, stars in between", () => {
    expect(altitudeOf(flying({ hamster: { ...flying().hamster, y: C.GROUND_Y } }))).toBe(0);
    expect(
      altitudeOf(flying({ hamster: { ...flying().hamster, y: C.SPACE_BG_Y + C.GROUND_Y } })),
    ).toBe(1);
    const day = skyColours(0);
    const space = skyColours(1);
    expect(day.top).toEqual([116, 182, 226]);
    expect(space.top).toEqual([12, 16, 40]);
    expect(day.starAlpha).toBe(0);
    expect(skyColours(0.35).starAlpha).toBe(0);
    expect(skyColours(0.55).starAlpha).toBeCloseTo(0.5, 10);
    expect(space.starAlpha).toBe(1);
  });

  it("bakes a fixed star field that scales with stress", () => {
    expect(starField(1)).toHaveLength(STAR_COUNT);
    expect(starField(4)).toHaveLength(STAR_COUNT * 4);
    expect(starField(1)).toEqual(starField(1));
    for (const star of starField(1)) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(C.VIEW_W);
      expect(star.y).toBeLessThan(C.VIEW_H);
    }
  });
});

describe("ground decoration", () => {
  it("places bushes across the view from a stable hash", () => {
    const a = bushes(-650, 1);
    expect(a).toEqual(bushes(-650, 1));
    expect(a.length).toBeGreaterThan(2);
    for (const bush of a) {
      expect(BUSHES).toContain(bush.sprite);
      expect(bush.y).toBe(C.GROUND_Y);
    }
    // Neighbouring slots are a spacing apart, give or take the jitter.
    const xs = a.map((b) => b.x);
    for (let i = 1; i < xs.length; i++) {
      expect(Math.abs((xs[i] ?? 0) - (xs[i - 1] ?? 0) - BUSH_SPACING)).toBeLessThan(90);
    }
  });

  it("keeps distinct bushes under stress, where the slots are fractional", () => {
    const under = bushes(-650, 3);
    expect(under.length).toBeGreaterThan(bushes(-650, 1).length * 2);
    expect(new Set(under.map((b) => b.sprite)).size).toBeGreaterThan(1);
  });

  it("labels every fifth marker in the unit the mode shows", () => {
    // Ticks every 10 ft, a label every 50 ft: the view around 5 000 px has one.
    const feet = markers(-5000, false);
    // 800 px of view, a tick every 1 000: the one on screen plus the one the
    // floor keeps just off its left edge.
    expect(feet.ticks).toEqual([4000, 5000]);
    expect(feet.labels).toEqual([{ x: 5000, text: "50ft" }]);
    // Metres: ticks every 5 m (about 1 640 px), a label every 25 m (8 202 px).
    const metres = markers(-8200, true);
    expect(metres.labels.map((l) => l.text)).toEqual(["25m"]);
    expect(metres.ticks.length).toBeGreaterThanOrEqual(1);
    // Ticks start at the origin, never behind it.
    expect(markers(0, false).ticks[0]).toBe(0);
    expect(markers(0, false).labels[0]).toEqual({ x: 0, text: "0ft" });
  });

  it("leaves a collectible standing on its first frame", () => {
    // `attachMovie` and nothing else: the clip runs only when `_loc3_.play()`
    // fires on pickup. Every one of these is longer than the item pose -
    // `powerup/bounce` is 26 frames, of which the last 20 are blank - so
    // indexing them off a clock blinked the collectible out for most of every
    // cycle. That is the whole reason this constant is not a frame counter.
    expect(POWERUP_IDLE_FRAME).toBe(0);
    const animated = Object.values(POWERUP_SPRITE).filter((id) => SPRITES[id].frames > 1);
    expect(animated.length).toBeGreaterThan(0);
    for (const id of animated) expect(SPRITES[id].frames).toBeGreaterThan(2);
  });

  it("shrinks the shadow with height and never flips it", () => {
    expect(shadowScale(C.SHADOW_REF_Y + C.SHADOW_DIV)).toBeCloseTo(1, 10);
    expect(shadowScale(600)).toBe(0);
  });
});

describe("hud strings", () => {
  it("sums the board and formats the panel", () => {
    const s = flying();
    expect(totalFeet(s)).toBe(165);
    expect(panelLines(s, false)).toEqual(["try 2/5", "8 ft   total 165 ft"]);
    expect(panelLines(s, true)).toEqual(["try 2/5", "2 m   total 50 m"]);
    expect(panelLines(flying({ turn: 6 }), false)[0]).toBe("try 5/5");
  });

  it("fills the glide bar by the meter and turns red when empty", () => {
    expect(glideFill(flying({ glidePoints: 50 }))).toEqual({ fraction: 0.5, colour: 0xffd166 });
    expect(glideFill(flying({ glidePoints: 0 }))).toEqual({ fraction: 0, colour: 0xff6b6b });
    expect(glideFill(flying({ glidePoints: 250 })).fraction).toBe(1);
  });

  it("prompts by phase and falls silent while skidding", () => {
    expect(promptFor(flying({ phaseKind: "ready" }), false)).toBe("click to jump");
    expect(promptFor(flying({ phaseKind: "jumping" }), false)).toBe(
      "click again to hit the pillow",
    );
    expect(promptFor(flying(), false)).toBe("hold to glide");
    expect(promptFor(flying({ flags: { ...noEffects(), skidding: true } }), false)).toBeNull();
    expect(promptFor(flying({ phaseKind: "settling" }), false)).toBeNull();
    expect(promptFor(flying({ phaseKind: "gameOver" }), false)).toBe(
      "165 ft total - click to play again",
    );
    expect(promptFor(flying({ paused: true }), false)).toBe("paused - P to resume");
  });

  it("lists only the flags that are on in the debug readout", () => {
    const lines = debugLines(flying({ flags: { ...noEffects(), glide: true, falling: true } }));
    expect(lines[0]).toBe("x 800.0  y 700.0");
    expect(lines[1]).toBe("xvel 20.00  yvel -10.00");
    expect(lines[2]).toBe("t10 flying glide falling");
  });
});

describe("interpolate", () => {
  const prev = flying({
    tick: 9,
    hamster: { ...flying().hamster, x: 780, y: 720 },
    camera: { x: -630, y: -600 },
  });
  const next = flying();

  it("places the hamster and the camera between two consecutive ticks", () => {
    const mid = interpolate(prev, next, 0.5);
    expect(mid.hamster.x).toBe(790);
    expect(mid.hamster.y).toBe(710);
    expect(mid.camera).toEqual({ x: -640, y: -600 });
    // Everything else is the newer tick's.
    expect(mid.hamster.xvel).toBe(20);
    expect(mid.tick).toBe(10);
  });

  it("is the new tick at alpha 0 and clamps at 1", () => {
    expect(interpolate(prev, next, 0)).toBe(next);
    expect(interpolate(prev, next, 1.5).hamster.x).toBe(800);
  });

  it("never smears across a phase change, a tick gap or a restart", () => {
    expect(interpolate({ ...prev, phaseKind: "jumping" }, next, 0.5)).toBe(next);
    expect(interpolate({ ...prev, tick: 7 }, next, 0.5)).toBe(next);
    expect(interpolate({ ...prev, turn: 1 }, next, 0.5)).toBe(next);
    expect(interpolate(null, next, 0.5)).toBe(next);
  });
});
