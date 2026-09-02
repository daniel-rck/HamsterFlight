import { describe, expect, it } from "vitest";
import { C } from "@/sim/constants.ts";
import { mulberry32 } from "@/sim/rng/mulberry32.ts";
import { spawnPowerups } from "@/sim/systems/PowerupSpawner.ts";
import { POWERUP_KINDS, type PowerupKind, powerupFromRoll } from "@/sim/types.ts";
import { makeFlight } from "../support/harness.ts";

describe("powerup roll table", () => {
  it("maps random(11) exactly as the switch does", () => {
    const expected: PowerupKind[] = [
      "bounce",
      "bounce",
      "speed",
      "speed",
      "speed",
      "wind",
      "wind",
      "wind",
      "slide",
      "rebound",
      "superbounce",
    ];
    expect(Array.from({ length: 11 }, (_, i) => powerupFromRoll(i))).toEqual(expected);
  });

  it("produces the documented 2/3/3/1/1/1 distribution", () => {
    const rng = mulberry32(0xc0ffee);
    const counts = new Map<PowerupKind, number>(POWERUP_KINDS.map((k) => [k, 0]));
    const n = 110_000;
    for (let i = 0; i < n; i++) {
      const kind = powerupFromRoll(rng.int(C.POWERUP_ROLL));
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const share = (k: PowerupKind) => ((counts.get(k) ?? 0) / n) * 11;
    expect(share("bounce")).toBeCloseTo(2, 1);
    expect(share("speed")).toBeCloseTo(3, 1);
    expect(share("wind")).toBeCloseTo(3, 1);
    expect(share("slide")).toBeCloseTo(1, 1);
    expect(share("rebound")).toBeCloseTo(1, 1);
    expect(share("superbounce")).toBeCloseTo(1, 1);
  });
});

describe("powerup spawning", () => {
  it("spawns 200 px right of the viewport, once per 150 px of camera travel", () => {
    const s = makeFlight({ x: 148, y: 700 });
    s.powerupMark = C.POWERUP_MARK_INIT;
    // camera.x = -x + 150, so the gate is 600 - camX = x + 450.
    s.camera.x = -s.p.x + C.CAM_ANCHOR_X;

    const rng = mulberry32(5);
    spawnPowerups(s, rng);
    expect(s.powerups).toHaveLength(0); // 148 + 450 = 598 < 650

    s.p.x = 260;
    s.camera.x = -s.p.x + C.CAM_ANCHOR_X;
    spawnPowerups(s, rng);
    expect(s.powerups).toHaveLength(1);
    expect(s.powerupMark).toBe(C.POWERUP_MARK_INIT + C.SPAWN_EVERY_PX);
    // x = 800 - camX = x + 650
    expect(s.powerups[0]?.x).toBeCloseTo(260 + 650, 10);
  });

  it("puts rebound on the ground and everything else in the air", () => {
    const seen = new Map<PowerupKind, number[]>();
    for (let seed = 0; seed < 400; seed++) {
      const s = makeFlight({ x: 5000, y: 700 });
      s.powerupMark = 0;
      s.camera.x = -s.p.x + C.CAM_ANCHOR_X;
      spawnPowerups(s, mulberry32(seed));
      const it = s.powerups[0];
      if (it === undefined) continue;
      const list = seen.get(it.kind) ?? [];
      list.push(it.y);
      seen.set(it.kind, list);
    }
    for (const y of seen.get("rebound") ?? []) expect(y).toBe(C.REBOUND_Y);
    for (const [kind, ys] of seen) {
      if (kind === "rebound") continue;
      for (const y of ys) {
        expect(y).toBeLessThanOrEqual(C.POWERUP_Y_BASE);
        expect(y).toBeGreaterThan(C.POWERUP_Y_BASE - C.POWERUP_Y_RAND);
      }
    }
  });
});
