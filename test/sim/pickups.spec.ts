import { describe, expect, it } from "vitest";
import { C } from "@/sim/constants.ts";
import type { SimEvent } from "@/sim/events.ts";
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
    expect(Object.isFrozen(DEFAULT_TUNING.outcomeHoldTicks)).toBe(true);
    expect(Object.isFrozen(POWERUPS.speed)).toBe(true);
  });
});
