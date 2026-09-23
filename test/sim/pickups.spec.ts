import { describe, expect, it } from "vitest";
import { C } from "@/sim/constants.ts";
import type { SimEvent } from "@/sim/events.ts";
import { rotateBox } from "@/sim/math/aabb.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";
import { POWERUP_KINDS, POWERUPS, type PowerupKind } from "@/sim/types.ts";
import { centredOn, makeFlight, tick } from "../support/harness.ts";

const sfxIds = (events: readonly SimEvent[]) =>
  events.filter((e) => e.t === "sfx").map((e) => (e.t === "sfx" ? e.id : ""));

describe("pickup sounds", () => {
  it("plays sndPickup for bounce, superbounce and slide only", () => {
    // Game.as:700, 715, 749 call playSound; the speed (:719), wind (:733) and
    // rebound (:753) branches do not.
    const expected: Record<PowerupKind, boolean> = {
      bounce: true,
      superbounce: true,
      slide: true,
      speed: false,
      wind: false,
      rebound: false,
    };
    for (const kind of POWERUP_KINDS) {
      const s = makeFlight({ y: 600, xvel: 10, powerups: [centredOn(kind, C.HAMSTER_X, 600)] });
      const { events } = tick(s);
      expect(
        events.some((e) => e.t === "pickup" && e.kind === kind),
        kind,
      ).toBe(true);
      expect(sfxIds(events).includes("pickup"), kind).toBe(expected[kind]);
      expect(POWERUPS[kind].sound).toBe(expected[kind]);
    }
  });

  it("sounds speed and rebound through their own clips", () => {
    // `_speed` starts sound 464 on frame 2, the frame `play()` sends it to;
    // `_rebound` starts 457 on frame 4 (display-lists.txt, sprites 465/462).
    const heard = (kind: PowerupKind) => {
      const s = makeFlight({ y: 600, xvel: 10, powerups: [centredOn(kind, C.HAMSTER_X, 600)] });
      return tick(s).events.filter((e) => e.t === "sfx" && e.id === kind);
    };
    expect(heard("speed")).toEqual([{ t: "sfx", id: "speed", gain: C.SFX_VOLUME }]);
    expect(heard("rebound")).toEqual([
      { t: "sfx", id: "rebound", gain: C.SFX_VOLUME, delayFrames: 3 },
    ]);
  });
});

describe("rebound pickup", () => {
  it("picks a skidding hamster back up: skidding, slide and falling are cleared", () => {
    // Game.as:757-766. Leaving `skidding` set would have blocked glide for the
    // rest of the shot, because onMouseDown tests `shooting && !skidding`.
    const s = makeFlight({
      y: C.GROUND_Y,
      xvel: 3,
      yvel: 0,
      hit: true,
      flags: { skidding: true, slide: true, falling: true },
      powerups: [centredOn("rebound", C.HAMSTER_X, C.GROUND_Y)],
    });
    const { events, done } = tick(s);
    expect(done).toBe(false);
    expect(s.flags.skidding).toBe(false);
    expect(s.flags.slide).toBe(false);
    expect(s.flags.falling).toBe(false);
    expect(s.flags.rebound).toBe(false); // consumed at step 4 of the same tick
    expect(s.p.doRotation).toBe(true);
    // The impulse is applied on the same tick, then drag and gravity.
    expect(s.p.xvel).toBeCloseTo(C.REBOUND_XVEL * C.DRAG, 10);
    expect(s.p.yvel).toBeCloseTo(C.REBOUND_YVEL + C.GRAV, 10);
    expect(events).toContainEqual({ t: "falling", on: false });
  });

  it("drops slide only when the hamster was skidding at the time", () => {
    // `if (slide && skidding) slide = false` - a slide armed in the air survives.
    const s = makeFlight({
      y: 600,
      xvel: 10,
      flags: { slide: true },
      powerups: [centredOn("rebound", C.HAMSTER_X, 600)],
    });
    tick(s);
    expect(s.flags.slide).toBe(true);
    expect(s.flags.skidding).toBe(false);
  });

  it("lets the player glide again after a rebound out of a skid", () => {
    const s = makeFlight({
      y: C.GROUND_Y,
      xvel: 3,
      hit: true,
      flags: { skidding: true },
      powerups: [centredOn("rebound", C.HAMSTER_X, C.GROUND_Y)],
    });
    tick(s);
    // Airborne again and no longer skidding, so the next tick does not re-skid.
    tick(s);
    expect(s.flags.skidding).toBe(false);
    expect(s.p.y).toBeLessThan(C.SKID_Y);
  });
});

describe("arming pickups", () => {
  it("ends a fall with an event, not silently", () => {
    const s = makeFlight({
      y: 600,
      xvel: 10,
      yvel: 60,
      flags: { falling: true },
      powerups: [centredOn("bounce", C.HAMSTER_X, 600)],
    });
    const { events } = tick(s);
    expect(s.flags.bounce).toBe(true);
    expect(s.flags.falling).toBe(false);
    expect(events.filter((e) => e.t === "falling")).toEqual([{ t: "falling", on: false }]);
  });
});

describe("shared tables", () => {
  it("are frozen all the way down", () => {
    expect(Object.isFrozen(DEFAULT_TUNING.powerupActiveTicks)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TUNING.boxes.powerups.wind)).toBe(true);
    expect(Object.isFrozen(POWERUPS.speed)).toBe(true);
  });
});

describe("the wind cue", () => {
  it("plays on every other wind tick, as the original's windSound toggle does", () => {
    // Game.as:512-520: the cue plays when `windSound` is false and flips it
    // either way, so three wind ticks in a row sound twice (first and third).
    const s = makeFlight({ y: 600, xvel: 10 });
    const played: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      s.flags.wind = true;
      played.push(sfxIds(tick(s).events).includes("wind"));
    }
    expect(played).toEqual([true, false, true]);
  });
});

describe("rotated flight core", () => {
  // `core.hitTest(this.bc.core)` measures stage-space bounds of the rotated
  // flight clip (Game.as:690 ff., Bullet.as:50), so the tall core lies on its
  // side in level flight: wide in x, short in y.
  const core = DEFAULT_TUNING.boxes.hamsterFlightCore;
  const item = DEFAULT_TUNING.boxes.powerups.speed;
  const x = 1000;
  const y = 600;

  /** A speed pickup offset from the rotated core's centre by (dx, dy). */
  function offsetBy(rotationDeg: number, dx: number, dy: number) {
    const turned = rotateBox(core, rotationDeg);
    return {
      kind: "speed" as const,
      x: x + turned.cx + dx - item.cx,
      y: y + turned.cy + dy - item.cy,
    };
  }

  function picks(rotationDeg: number, dx: number, dy: number): boolean {
    const s = makeFlight({ x, y, xvel: 10, powerups: [offsetBy(rotationDeg, dx, dy)] });
    s.p.rotationDeg = rotationDeg;
    return tick(s).events.some((e) => e.t === "pickup");
  }

  // Between the upright x window (19.9 + 8) and the level one (32.5 + 8).
  const between = (core.hw + core.hh) / 2 + item.hw;

  it("reaches further in x and less far in y in level flight", () => {
    expect(picks(90, between, 0)).toBe(true);
    expect(picks(90, 0, between)).toBe(false);
  });

  it("is upright when the clip points straight up", () => {
    expect(picks(0, between, 0)).toBe(false);
    expect(picks(0, 0, between)).toBe(true);
  });
});
