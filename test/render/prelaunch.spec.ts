import { describe, expect, it } from "vitest";
import { type Placement, PreLaunchScene } from "@/render/PreLaunchScene.ts";
import { C } from "@/sim/constants.ts";
import type { Phase, SimSnapshot } from "@/sim/state.ts";
import { noEffects } from "@/sim/types.ts";

const FRAME_MS = 1000 / 19;

interface Setup {
  readonly phase?: Phase["kind"];
  readonly turn?: number;
  readonly walkOut?: number | null;
  readonly y?: number;
  readonly yvel?: number;
  readonly shots?: readonly number[];
}

function snap(setup: Setup = {}): SimSnapshot {
  return {
    tick: 0,
    phaseKind: setup.phase ?? "ready",
    turn: setup.turn ?? 1,
    paused: false,
    swung: false,
    windup: null,
    walkOut: setup.walkOut ?? null,
    hamster: {
      x: C.HAMSTER_X,
      y: setup.y ?? C.HAMSTER_START_Y,
      xvel: 0,
      yvel: setup.yvel ?? 0,
      visible: (setup.walkOut ?? null) === null,
      doRotation: false,
      rotationDeg: 0,
    },
    camera: { x: 0, y: 0 },
    powerups: [],
    glidePoints: C.GLIDE_MAX,
    flags: noEffects(),
    balls: [],
    shots: setup.shots ?? [],
    feet: 0,
    outcome: null,
    outcomeClip: null,
    restartable: false,
  };
}

function only(world: readonly Placement[], sprite: string): Placement[] {
  return world.filter((at) => at.sprite === sprite);
}

function swingFrame(scene: PreLaunchScene, s: SimSnapshot, nowMs: number): number {
  return only(scene.layout(s, nowMs).world, "launcher/swing")[0]?.frame ?? -1;
}

describe("the launcher", () => {
  it("idles until the first click, then holds the wind-up", () => {
    const scene = new PreLaunchScene();
    expect(swingFrame(scene, snap({ phase: "ready" }), 0)).toBe(0);
    // Frames 2-4 are the same picture, so the wind-up is a single held pose.
    expect(swingFrame(scene, snap({ phase: "jumping" }), 0)).toBe(3);
    expect(swingFrame(scene, snap({ phase: "jumping" }), 5000)).toBe(3);
  });

  it("plays frames 5 to 7 on a hit and drops back to idle", () => {
    const scene = new PreLaunchScene();
    scene.consume([{ t: "launched", vel: 40, angleDeg: 45 }], 1000);
    const flying = snap({ phase: "flying" });
    expect(swingFrame(scene, flying, 1000)).toBe(4);
    expect(swingFrame(scene, flying, 1000 + FRAME_MS * 2.5)).toBe(6);
    expect(swingFrame(scene, flying, 1000 + FRAME_MS * 3.5)).toBe(0);
  });

  it("plays the forty-frame whiff on a miss, over the hamster still bobbing", () => {
    const scene = new PreLaunchScene();
    scene.consume([{ t: "missed" }], 0);
    const jumping = snap({ phase: "jumping" });
    expect(swingFrame(scene, jumping, 0)).toBe(9);
    expect(swingFrame(scene, jumping, FRAME_MS * 39.5)).toBe(48);
    // ...and once it has run out the wind-up pose comes back, not the idle one.
    expect(swingFrame(scene, jumping, FRAME_MS * 40.5)).toBe(3);
  });

  it("runs the wheels only while the hamster is bobbing", () => {
    const scene = new PreLaunchScene();
    const at = (s: SimSnapshot, ms: number): number[] =>
      scene
        .layout(s, ms)
        .world.filter((p) => p.sprite.startsWith("launcher/wheel"))
        .map((p) => p.frame);

    expect(at(snap({ phase: "ready" }), FRAME_MS * 5)).toEqual([0, 0]);
    expect(at(snap({ phase: "jumping" }), FRAME_MS * 5)).toEqual([5, 5]);
    // Two wheels of different lengths, so they come apart rather than lock step.
    expect(at(snap({ phase: "jumping" }), FRAME_MS * 31)).toEqual([31, 1]);
    expect(at(snap({ phase: "flying" }), FRAME_MS * 31)).toEqual([0, 0]);
  });
});

describe("the hamster queue", () => {
  it("lines four up on the first turn", () => {
    const scene = new PreLaunchScene();
    const queue = only(scene.layout(snap({ turn: 1 }), 0).world, "queue/hamster");
    expect(queue.map((at) => at.x)).toEqual([30.5, 15.5, 0.5, -14.5]);
    expect(queue.every((at) => at.frame === 0)).toBe(true);
  });

  it("shortens from the front and shuffles the rest one slot up", () => {
    // The walk is over: only the settled queue is left.
    const queue = only(new PreLaunchScene().layout(snap({ turn: 2 }), 5000).world, "queue/hamster");
    expect(queue.map((at) => at.x)).toEqual([30.5, 15.5, 0.5]);
  });

  it("empties by the last turn", () => {
    const scene = new PreLaunchScene();
    expect(only(scene.layout(snap({ turn: 5 }), 40000).world, "queue/hamster")).toHaveLength(0);
  });

  it("walks the departing one out while the others step up in place", () => {
    const scene = new PreLaunchScene();
    const queue = only(scene.layout(snap({ turn: 2, walkOut: 1 }), 0).world, "queue/hamster");
    // The one leaving is on its walk-out run; the three behind are mid-walkUp
    // and still standing in the slots they have not yet moved out of.
    expect(queue.map((at) => at.frame)).toEqual([0, 19, 19, 19]);
    expect(queue.map((at) => at.x)).toEqual([30.5, 15.5, 0.5, -14.5]);
  });

  it("finishes the shuffle first, then walks on alone", () => {
    // Eight ticks in: `walkUp`'s seven frames are done, the walker is not.
    const queue = only(
      new PreLaunchScene().layout(snap({ turn: 2, walkOut: 8 }), 0).world,
      "queue/hamster",
    );
    expect(queue.map((at) => at.frame)).toEqual([7, 0, 0, 0]);
    expect(queue.map((at) => at.x)).toEqual([30.5, 30.5, 15.5, 0.5]);
  });

  it("hands the walker over to the pad hamster on the same tick", () => {
    const scene = new PreLaunchScene();
    // The last tick of the walk still draws it, near the end of its run.
    const walking = only(scene.layout(snap({ turn: 2, walkOut: 14 }), 0).world, "queue/hamster");
    expect(walking[0]?.frame).toBe(13);
    // Clip 53's frame 15: the walker is gone and the pad hamster is back.
    const arrived = snap({ turn: 2, walkOut: null });
    expect(arrived.hamster.visible).toBe(true);
    expect(only(scene.layout(arrived, 0).world, "queue/hamster")).toHaveLength(3);
  });

  it("draws from the snapshot alone, so a tab coming back replays nothing", () => {
    const seen = new PreLaunchScene();
    seen.layout(snap({ turn: 3 }), 0);
    const mid = snap({ turn: 4, walkOut: 5 });
    expect(only(seen.layout(mid, 100).world, "queue/hamster")).toEqual(
      only(new PreLaunchScene().layout(mid, 100).world, "queue/hamster"),
    );
  });

  it("forgets the queue when the game restarts", () => {
    const scene = new PreLaunchScene();
    scene.layout(snap({ turn: 4 }), 0);
    scene.clear();
    const queue = only(scene.layout(snap({ turn: 1 }), 100).world, "queue/hamster");
    expect(queue.map((at) => at.x)).toEqual([30.5, 15.5, 0.5, -14.5]);
  });
});

describe("the launch meter", () => {
  it("is up before the shot and down once the hamster is away", () => {
    const scene = new PreLaunchScene();
    const up = (phase: Phase["kind"]): boolean => scene.layout(snap({ phase }), 0).needle !== null;
    expect(up("ready")).toBe(true);
    expect(up("jumping")).toBe(true);
    expect(up("flying")).toBe(false);
    expect(up("settling")).toBe(false);
    expect(up("gameOver")).toBe(false);
  });

  it("reads the needle off the hamster, clamped at both ends", () => {
    const scene = new PreLaunchScene();
    const y = (at: number): number =>
      scene.layout(snap({ phase: "jumping", y: at }), 0).needle?.y ?? Number.NaN;
    // 48 + 0.35417 * (y - 715), clamped to 10..100, on top of the meter's y = 3.
    expect(y(715)).toBeCloseTo(3 + 48, 4);
    expect(y(C.HAMSTER_START_Y)).toBeCloseTo(3 + 100, 4);
    expect(y(600)).toBeCloseTo(3 + 10, 4);
  });

  it("flips the needle on the way down", () => {
    const scene = new PreLaunchScene();
    const flipped = (yvel: number): boolean =>
      scene.layout(snap({ phase: "jumping", yvel }), 0).needle?.flipped ?? false;
    expect(flipped(-12)).toBe(false);
    expect(flipped(0)).toBe(false);
    expect(flipped(3)).toBe(true);
  });
});

describe("the shot pips", () => {
  it("lights one per shot on the board", () => {
    const scene = new PreLaunchScene();
    const lit = (shots: readonly number[]): number[] =>
      scene
        .layout(snap({ shots }), 0)
        .hud.filter((at) => at.sprite === "hud/shotPip")
        .map((at) => at.frame);

    expect(lit([])).toEqual([0, 0, 0, 0, 0]);
    expect(lit([120, 0])).toEqual([1, 1, 0, 0, 0]);
    expect(lit([1, 2, 3, 4, 5])).toEqual([1, 1, 1, 1, 1]);
  });
});
