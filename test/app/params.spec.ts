import { describe, expect, it } from "vitest";
import { modeFromUrl, rendererFromUrl } from "@/app/GameMode.ts";
import { MAX_STRESS, profileWindowFromUrl, seedFromUrl, stressFromUrl } from "@/app/params.ts";

const q = (s: string) => new URLSearchParams(s);
const silent = (): void => undefined;

describe("?seed", () => {
  it("parses a decimal seed as an unsigned 32-bit value", () => {
    expect(seedFromUrl(q("seed=12345"))).toBe(12345);
    expect(seedFromUrl(q("seed=-1"))).toBe(0xffffffff);
  });

  it("falls back to a random seed for garbage", () => {
    expect(seedFromUrl(q("seed=abc"), () => 99)).toBe(99);
    expect(seedFromUrl(q(""), () => 7)).toBe(7);
  });
});

describe("?stress", () => {
  it("is 1 unless given a positive integer, and is capped", () => {
    expect(stressFromUrl(q(""))).toBe(1);
    expect(stressFromUrl(q("stress=abc"))).toBe(1);
    expect(stressFromUrl(q("stress=0"))).toBe(1);
    expect(stressFromUrl(q("stress=16"))).toBe(16);
    expect(stressFromUrl(q("stress=1000000"))).toBe(MAX_STRESS);
  });
});

describe("?profileWindow", () => {
  it("defaults to the profiler window", () => {
    expect(profileWindowFromUrl(q(""))).toBe(240);
    expect(profileWindowFromUrl(q("profileWindow=60"))).toBe(60);
    expect(profileWindowFromUrl(q("profileWindow=x"))).toBe(240);
  });
});

describe("?mode and ?renderer", () => {
  it("defaults to enhanced on pixi", () => {
    expect(modeFromUrl(q(""), silent)).toBe("enhanced");
    expect(rendererFromUrl(q(""), "enhanced", silent)).toBe("pixi");
    expect(rendererFromUrl(q(""), "faithful", silent)).toBe("canvas2d");
  });

  it("warns on a typo and keeps the default rather than silently switching", () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(modeFromUrl(q("mode=fatihful"), warn)).toBe("enhanced");
    // A bad renderer value follows the mode, not a hard-coded backend.
    expect(rendererFromUrl(q("renderer=pixijs"), "enhanced", warn)).toBe("pixi");
    expect(rendererFromUrl(q("renderer="), "faithful", warn)).toBe("canvas2d");
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("fatihful");
  });

  it("honours an explicit override", () => {
    expect(rendererFromUrl(q("renderer=canvas2d"), "enhanced", silent)).toBe("canvas2d");
    expect(rendererFromUrl(q("renderer=pixi"), "faithful", silent)).toBe("pixi");
  });
});
