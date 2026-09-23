import { describe, expect, it } from "vitest";
import { C } from "@/sim/constants.ts";
import { Projectile } from "@/sim/entities/Projectile.ts";
import { toTwips, TWIPS_PER_PX } from "@/sim/math/twips.ts";
import { mulberry32 } from "@/sim/rng/mulberry32.ts";
import type { CameraState } from "@/sim/state.ts";
import { beginQuickPan, follow, newCamera, quickPanStep } from "@/sim/systems/CameraModel.ts";
import { spawnPowerups } from "@/sim/systems/PowerupSpawner.ts";
import { makeFlight } from "../support/harness.ts";

/** True when `v` is a whole number of twips. */
const onGrid = (v: number) => Number.isInteger(Math.round(v * TWIPS_PER_PX * 1e6) / 1e6);

describe("twips", () => {
  it("rounds to the nearest twip on both sides of zero", () => {
    expect(toTwips(10.12)).toBe(10.1);
    expect(toTwips(10.13)).toBe(10.15);
    expect(toTwips(-10.12)).toBe(-10.1);
    expect(toTwips(-10.13)).toBe(-10.15);
    expect(toTwips(950)).toBe(950);
  });

  it("leaves values already on the grid alone", () => {
    for (let k = -200_000; k <= 200_000; k += 7) {
      const v = k / TWIPS_PER_PX;
      expect(toTwips(v)).toBe(v);
    }
  });

  it("puts the hamster, and the ox/oy read back from it, on the grid", () => {
    // Bullet.as:51-52 write clip properties; Bullet.as:42-43 read them back.
    const p = new Projectile(148, 740.25, 0, 0, C.GRAV);
    p.xvel = 31.337;
    p.yvel = -7.1234;
    p.integrate();
    expect(p.x).toBe(toTwips(148 + 31.337));
    expect(p.y).toBe(toTwips(740.25 - 7.1234));
    p.integrate();
    expect(onGrid(p.ox) && onGrid(p.oy) && onGrid(p.x) && onGrid(p.y)).toBe(true);
    // Velocities are plain Numbers.
    expect(p.xvel).toBe(31.337);
  });

  it("puts the camera and the spawn x on the grid", () => {
    const cam = newCamera();
    follow(cam, 1234.5678, 432.1987);
    expect(cam.x).toBe(toTwips(-1234.5678 + C.CAM_ANCHOR_X));
    expect(cam.y).toBe(toTwips(-432.1987 + C.CAM_ANCHOR_Y));

    // Game.as:1325 - `_x = 800 - camX`.
    const s = makeFlight({ powerupMark: 0 });
    s.camera.x = -1001.2345;
    spawnPowerups(s, mulberry32(1));
    const spawned = s.powerups[0];
    expect(spawned).toBeDefined();
    if (spawned === undefined) return;
    expect(spawned.x).toBe(toTwips(C.SPAWN_AHEAD_X + 1001.2345));
  });

  it("pans with a full-precision accumulator behind a quantised container", () => {
    // GameCamera.as:152-153, 184-187: cameraTargetX/Y are plain Numbers,
    // `_$mc._x = -cameraTargetX` is quantised.
    const cam: CameraState = { x: -4000, y: -600 };
    const pan = beginQuickPan(cam);
    quickPanStep(cam, pan, C.CAM_RESET_TARGET_X, C.CAM_RESET_TARGET_Y, 3);
    expect(cam.x).toBe(toTwips(pan.x));
    expect(cam.y).toBe(toTwips(pan.y));
    expect(onGrid(pan.x) && onGrid(pan.y)).toBe(false);
  });
});
