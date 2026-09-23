import { describe, expect, it } from "vitest";
import { SPRITES } from "@/assets/sprites.generated.ts";
import { clipStep, PoseClock, windupFrame } from "@/render/PoseClock.ts";
import { C } from "@/sim/constants.ts";
import type { Phase, SimSnapshot } from "@/sim/state.ts";
import { noEffects, type ShotOutcome } from "@/sim/types.ts";

const FRAME_MS = 1000 / 19;
/**
 * The middle of frame `n`, rather than its exact boundary. `1000 / 19` is not
 * representable, so asking for a boundary exactly lands a hair below it - a
 * float artefact of the test's arithmetic, not of the clock's.
 */
const mid = (frame: number): number => (frame + 0.5) * FRAME_MS;
const JUMP = SPRITES["hamster/jump"];
const ZERO = SPRITES["hit/zero"];
const FLY = SPRITES["hamster/fly"];

interface Setup {
  readonly phase?: Phase["kind"];
  readonly outcome?: ShotOutcome | null;
  readonly windup?: number | null;
}

function snap(setup: Setup = {}): SimSnapshot {
  return {
    tick: 0,
    phaseKind: setup.phase ?? "ready",
    turn: 1,
    paused: false,
    swung: false,
    windup: setup.windup ?? null,
    hamster: {
      x: C.HAMSTER_X,
      y: C.HAMSTER_START_Y,
      xvel: 0,
      yvel: 0,
      visible: true,
      doRotation: false,
      rotationDeg: 0,
    },
    camera: { x: 0, y: 0 },
    powerups: [],
    glidePoints: C.GLIDE_MAX,
    flags: noEffects(),
    shots: [],
    feet: 0,
    outcome: setup.outcome ?? null,
  };
}

describe("clipStep", () => {
  it("counts frames from the anchor at the sprite rate", () => {
    expect(clipStep(1000, 1000, 19)).toBe(0);
    expect(clipStep(1000, 1000 + mid(1), 19)).toBe(1);
    expect(clipStep(1000, 1000 + mid(9), 19)).toBe(9);
  });

  it("never goes negative, so an anchor in the future reads as frame 0", () => {
    expect(clipStep(2000, 1000, 19)).toBe(0);
  });
});

describe("the hamster clip", () => {
  it("holds frame 1 on the pad however long the page has been open", () => {
    const clock = new PoseClock();
    const ready = snap();
    expect(clock.frame(ready, JUMP, 0)).toBe(0);
    expect(clock.frame(ready, JUMP, 30_000)).toBe(0);
    expect(clock.frame(ready, JUMP, 1_000_000)).toBe(0);
  });

  it("follows the simulation's wind-up tick, not the wall clock", () => {
    // Label `jump` is frame 2 (index 1); the stage rate from there.
    const clock = new PoseClock();
    clock.frame(snap(), JUMP, 0);
    expect(clock.frame(snap({ phase: "jumping", windup: 1 }), JUMP, 12_000)).toBe(1);
    expect(clock.frame(snap({ phase: "jumping", windup: 1 }), JUMP, 99_000)).toBe(1);
    expect(clock.frame(snap({ phase: "jumping", windup: 10 }), JUMP, 0)).toBe(10);
    expect(windupFrame(27)).toBe(26);
    // Never into the ball while the clip is still on the pad.
    expect(windupFrame(1000)).toBe(26);
  });

  it("holds frame 28 after the lift and loops the nested ball on it", () => {
    const clock = new PoseClock();
    const air = snap({ phase: "jumping", windup: null });
    clock.frame(snap({ phase: "jumping", windup: 27 }), JUMP, 0);
    // The lift re-anchors: the ball starts on its own frame 1.
    expect(clock.frame(air, JUMP, 5_000)).toBe(27);
    expect(clock.frame(air, JUMP, 5_000 + mid(3))).toBe(30);
    expect(clock.frame(air, JUMP, 5_000 + mid(4))).toBe(27);
    // The blank frame 36 and the flattened extra ball frames are never shown.
    for (let f = 0; f < 60; f++) {
      const i = clock.frame(air, JUMP, 5_000 + mid(f));
      expect(i).toBeGreaterThanOrEqual(27);
      expect(i).toBeLessThanOrEqual(30);
    }
  });

  it("plays an outcome clip once and holds its last frame", () => {
    const clock = new PoseClock();
    const settling = snap({ phase: "settling", outcome: "zero" });
    expect(clock.frame(settling, ZERO, 0)).toBe(0);
    expect(clock.frame(settling, ZERO, mid(4))).toBe(4);
    expect(clock.frame(settling, ZERO, mid(1000))).toBe(ZERO.frames - 1);
  });

  it("restarts whenever the pose changes", () => {
    const clock = new PoseClock();
    const flying = snap({ phase: "flying" });
    clock.frame(flying, FLY, 0);
    expect(clock.frame(flying, FLY, mid(3))).toBe(3);
    // Same phase, different pose: the ball clip starts from its own frame 0.
    const bounced = { ...flying, flags: { ...noEffects(), bounce: true } };
    expect(clock.frame(bounced, SPRITES["hamster/ball"], mid(3))).toBe(0);
  });

  it("shares its anchor with the clip drawn inside the bubble", () => {
    const clock = new PoseClock();
    const bounced = { ...snap({ phase: "flying" }), flags: { ...noEffects(), bounce: true } };
    clock.frame(bounced, SPRITES["hamster/ball"], 5000);
    expect(clock.innerFrame(FLY, 5000 + mid(2))).toBe(2);
  });

  it("re-anchors after clear(), so a hidden tab does not skip the clip forward", () => {
    const clock = new PoseClock();
    const flying = snap({ phase: "flying" });
    clock.frame(flying, FLY, 0);
    clock.clear();
    expect(clock.frame(flying, FLY, 60_000)).toBe(0);
  });

  it("pins single-frame sprites to 0", () => {
    const clock = new PoseClock();
    expect(clock.frame(snap({ phase: "flying" }), { frames: 1 }, 9999)).toBe(0);
  });
});
