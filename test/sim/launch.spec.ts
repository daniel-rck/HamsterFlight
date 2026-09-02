import { describe, expect, it } from "vitest";
import { C } from "@/sim/constants.ts";
import { PI_AS2 } from "@/sim/math/angles.ts";
import { attemptLaunch } from "@/sim/phases/Launch.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";

const launch = (y: number, yvel: number) =>
  attemptLaunch({ y, yvel, boost: true, swung: false }, DEFAULT_TUNING);

/** dy = y - PILLOW_Y - 5 is zero here, i.e. y = 745.9 - the optimum. */
const LEVEL_Y = C.PILLOW_Y - C.LAUNCH_DY_BIAS;

describe("launch geometry", () => {
  it("peaks at 52 when the hamster is level with the pillow centre", () => {
    // dy = 0 at y = 745.9, leaving dist = dx = 38 and vel = 90 - 38.
    const r = launch(LEVEL_Y, 0);
    expect(r.hit).toBe(true);
    expect(r.vel).toBeCloseTo(52, 10);
  });

  it("speed is nearness to the pillow centre, not a charge meter", () => {
    const centre = launch(LEVEL_Y, 0);
    const offCentre = launch(LEVEL_Y - 30, 0);
    expect(offCentre.vel).toBeLessThan(centre.vel);
  });

  it("the y clamp kills the rising bonus and aims slightly downwards", () => {
    // Anything below 759 is clamped to 759 with yvel forced to zero, so the
    // rising bonus cannot apply and the shot leaves at about 109 degrees.
    const r = launch(800, -12);
    expect(r.hit).toBe(false); // 800 is outside the pillow box entirely
    const clamped = launch(770, -12);
    expect(clamped.hit).toBe(true);
    expect(clamped.y).toBe(C.PILLOW_CLAMP_Y);
    expect(clamped.angleDeg).toBeCloseTo(109.0, 1);
    // No bonus: identical to the same position with yvel already zero.
    expect(clamped.vel).toBeCloseTo(launch(770, 0).vel, 12);
  });

  it("awards the rising bonus above the clamp", () => {
    const rising = launch(730, -12);
    const level = launch(730, 0);
    expect(rising.hit).toBe(true);
    expect(rising.vel).toBeGreaterThan(level.vel);
    // ad <= 90 above the pillow centre, so vel += -yvel/2 = +6.
    expect(rising.vel - level.vel).toBeCloseTo(6, 10);
  });

  it("misses outside the measured pillow box", () => {
    // Box from the SWF: hamster.core (16 px node scaled 1.7167) vs the whole
    // pillow clip, giving a window of roughly y in [694.7, 776.4].
    expect(launch(694, 0).hit).toBe(false);
    expect(launch(696, 0).hit).toBe(true);
    expect(launch(776, 0).hit).toBe(true);
    expect(launch(778, 0).hit).toBe(false);
  });

  it("uses the truncated pi the original defines, not Math.PI", () => {
    // ar = atan2(dy,dx) + PI_AS2/2, so the offset differs from Math.PI/2.
    const r = launch(LEVEL_Y, 0);
    expect(r.angleRad).toBeCloseTo(PI_AS2 / 2, 12);
    expect(r.angleRad).not.toBe(Math.PI / 2);
  });
});
