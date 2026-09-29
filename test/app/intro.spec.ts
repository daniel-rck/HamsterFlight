import { describe, expect, it } from "vitest";
import { STRINGS } from "@/app/i18n.ts";
import { INTRO_ITEMS, introModel } from "@/app/intro.ts";
import type { Mode } from "@/app/MetaGame.ts";
import { emptyProgress, type Progress } from "@/app/progress.ts";
import type { Replay } from "@/app/replay.ts";
import { GameSession } from "@/app/session.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";
import { POWERUP_KINDS } from "@/sim/types.ts";

const TODAY = "2026-09-29";
const en = STRINGS.en;
const free: Mode = { kind: "free" };
const ghost = (total: number): Replay => ({ seed: 1, total, shots: [], traces: [] });

describe("the opening screen", () => {
  it("offers free play first and today's challenge second", () => {
    const m = introModel(en, free, emptyProgress(), TODAY);
    expect(m.primary.label).toBe("Play");
    expect(m.secondary).toEqual({ label: "Daily challenge", sub: "Same powerups for everyone" });
    // Nothing to brag about on a first visit.
    expect(m.stats).toBeNull();
  });

  it("names today's best on the daily button, but not yesterday's", () => {
    const progress: Progress = {
      ...emptyProgress(),
      daily: { day: TODAY, total: 100, run: "" },
    };
    expect(introModel(en, free, progress, TODAY).secondary.sub).toBe("Today's best: 30.48 m");
    const stale = { ...progress, daily: { day: "2026-09-01", total: 100, run: "" } };
    expect(introModel(en, free, stale, TODAY).secondary.sub).toBe("Same powerups for everyone");
  });

  it("leads with the mode the link opened, and offers free play instead", () => {
    const daily: Mode = { kind: "daily", day: TODAY, ghost: null };
    expect(introModel(en, daily, emptyProgress(), TODAY).primary.label).toBe(
      "Play today's challenge",
    );
    const duel: Mode = { kind: "duel", ghost: ghost(200) };
    const m = introModel(en, duel, emptyProgress(), TODAY);
    expect(m.primary).toEqual({ label: "Race the ghost", sub: "To beat: 60.96 m" });
    expect(m.secondary.label).toBe("Free play");
  });

  it("shows the record and a live streak, and drops a broken one", () => {
    const progress: Progress = {
      ...emptyProgress(),
      bestTotal: 500,
      streak: { day: TODAY, count: 3 },
    };
    expect(introModel(en, free, progress, TODAY).stats).toBe("Record 152.40 m  ·  3-day streak");
    const lapsed = { ...progress, streak: { day: "2026-09-01", count: 3 } };
    expect(introModel(en, free, lapsed, TODAY).stats).toBe("Record 152.40 m");
  });

  it("describes every item, in both languages", () => {
    expect([...INTRO_ITEMS].sort()).toEqual([...POWERUP_KINDS].sort());
    for (const t of Object.values(STRINGS)) {
      for (const kind of POWERUP_KINDS) {
        const [name, what] = t.intro.items[kind];
        expect(name.length).toBeGreaterThan(0);
        expect(what.length).toBeGreaterThan(0);
      }
    }
  });

  it("says tap to a finger, click to a mouse and A to a pad", () => {
    for (const t of Object.values(STRINGS)) {
      const [touch, mouse, pad] = (["touch", "mouse", "pad"] as const).map((d) =>
        t.intro.steps(d).join(" "),
      );
      expect(touch).toMatch(/tap|tipp/i);
      expect(touch).not.toMatch(/click|klick|space|leertaste/i);
      expect(mouse).toMatch(/click|klick/i);
      expect(pad).toMatch(/\bA\b/);
      expect(pad).not.toMatch(/click|klick|tap|tipp/i);
    }
  });
});

describe("GameSession.reset", () => {
  it("is the session a fresh build on that seed would be", () => {
    const opts = { nextSeed: () => 9, tuning: DEFAULT_TUNING };
    const moved = new GameSession({ seed: 1, ...opts });
    moved.reset(42);
    const fresh = new GameSession({ seed: 42, ...opts });
    expect(moved.seed).toBe(42);
    expect(moved.snapshot).toEqual(fresh.snapshot);
    for (let i = 0; i < 30; i++) {
      expect(moved.step([]).snapshot).toEqual(fresh.step([]).snapshot);
    }
  });
});
