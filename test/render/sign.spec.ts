import { describe, expect, it } from "vitest";
import { ballBadge } from "@/render/scene/hud.ts";
import { poseFor } from "@/render/scene/pose.ts";
import {
  SIGN_FROM_FRAME,
  signFields,
  signScaleX,
  signText,
  signWidth,
} from "@/render/scene/signText.ts";
import { Simulation } from "@/sim/Simulation.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { noEffects, type ShotOutcome } from "@/sim/types.ts";

const base = new Simulation({ seed: 1 }).snapshot();

function settled(clip: ShotOutcome, shots: readonly number[] = [312, 1234]): SimSnapshot {
  return { ...base, phaseKind: "settling", outcome: clip, outcomeClip: clip, shots };
}

function flyingWith(balls: SimSnapshot["balls"], flags = noEffects()): SimSnapshot {
  return {
    ...base,
    phaseKind: "flying",
    balls,
    flags: { ...flags, bounce: balls[0] === "bounce", superbounce: balls[0] === "superbounce" },
  };
}

describe("the sign's distance", () => {
  it("goes up on frame 27 of the cheer and the hole, with the latest shot", () => {
    // DefineSprite_351_hit_cheer/frame_27: `distances[l - 1] + " ft."`.
    for (const clip of ["cheer", "hole"] as const) {
      const s = settled(clip);
      const pose = poseFor(s);
      expect(signText(s, pose, SIGN_FROM_FRAME - 1), clip).toBeNull();
      expect(signText(s, pose, SIGN_FROM_FRAME), clip).toBe("1234 ft.");
      expect(signText(s, pose, 49), clip).toBe("1234 ft."); // held to frame 50
    }
  });

  it("shows on the cheer a faceplant hands over to, and not on the faceplant", () => {
    const faceplant = settled("faceplant");
    expect(signFields(poseFor(faceplant))).toEqual([]);
    expect(signText(faceplant, poseFor(faceplant), 40)).toBeNull();
    const handedOver = { ...faceplant, outcomeClip: "cheer" as const };
    expect(signText(handedOver, poseFor(handedOver), 40)).toBe("1234 ft.");
  });

  it("puts the black field under the yellow one, as depths 6 and 7 do", () => {
    const [under, over] = signFields("hit/cheer");
    expect(under?.colour).toBe(0x000000);
    expect(over?.colour).toBe(0xffff33);
    expect(signFields("hit/hole")).toHaveLength(2);
  });

  it("sets a four-digit distance inside the field, as the original's glyphs do", () => {
    // Font 236's advances: "1234 ft." is 35.07 px against a 35.4 px text area.
    expect(signWidth("1234 ft.")).toBeCloseTo(35.07, 1);
    expect(signWidth("9999 ft.")).toBeLessThan(35.8);
    expect(signScaleX("1234 ft.", signWidth("1234 ft.") * 2)).toBeCloseTo(0.5, 10);
  });
});

describe("the stacked-ball badge", () => {
  it("counts from two balls up, while one is showing", () => {
    expect(ballBadge(flyingWith([]))).toBeNull();
    expect(ballBadge(flyingWith(["bounce"]))).toBeNull();
    expect(ballBadge(flyingWith(["bounce", "superbounce"]))).toBe("×2");
    expect(ballBadge(flyingWith(["superbounce", "bounce", "bounce"]))).toBe("×3");
  });

  it("hides while the skid covers the ball", () => {
    expect(
      ballBadge(flyingWith(["bounce", "bounce"], { ...noEffects(), skidding: true })),
    ).toBeNull();
  });
});
