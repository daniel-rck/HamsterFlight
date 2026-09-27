import { describe, expect, it } from "vitest";
import { dailySeed, dayKey, previousDay } from "@/app/daily.ts";
import {
  browserStore,
  emptyProgress,
  liveStreak,
  parseProgress,
  recordGame,
  recordShot,
  STORAGE_KEY,
  unlock,
  withSettings,
} from "@/app/progress.ts";

const game = (total: number, daily: string | null = null, shots = [total, 0, 0, 0, 0]) => ({
  total,
  shots,
  daily,
  run: `run${total}`,
});

describe("the daily challenge", () => {
  it("keys days locally and steps back across month and year ends", () => {
    expect(dayKey(new Date(2026, 8, 7))).toBe("2026-09-07");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
  });

  it("gives every day its own seed, the same one every time", () => {
    expect(dailySeed("2026-09-27")).toBe(dailySeed("2026-09-27"));
    expect(dailySeed("2026-09-27")).not.toBe(dailySeed("2026-09-28"));
    expect(dailySeed("2026-09-27")).toBeGreaterThan(0);
  });
});

describe("progress", () => {
  it("keeps the records and says when one fell", () => {
    const first = recordGame(emptyProgress(), game(300));
    expect(first.newBestTotal).toBe(true);
    expect(first.previousBestTotal).toBe(0);
    const second = recordGame(first.progress, game(200));
    expect(second.newBestTotal).toBe(false);
    expect(second.progress.bestTotal).toBe(300);
    expect(second.progress.games).toBe(2);
  });

  it("moves the shot record at once, not only at game over", () => {
    expect(recordShot(emptyProgress(), 120).bestShot).toBe(120);
    const p = recordShot(emptyProgress(), 120);
    expect(recordShot(p, 90)).toBe(p);
  });

  it("keeps the day's best run and counts a streak of days", () => {
    let p = recordGame(emptyProgress(), game(100, "2026-09-25")).progress;
    p = recordGame(p, game(80, "2026-09-25")).progress;
    expect(p.daily).toEqual({ day: "2026-09-25", total: 100, run: "run100" });
    expect(p.streak).toEqual({ day: "2026-09-25", count: 1 });
    p = recordGame(p, game(50, "2026-09-26")).progress;
    // A new day's first game is its best, however it compares with yesterday's.
    expect(p.daily?.total).toBe(50);
    expect(p.streak?.count).toBe(2);
    expect(liveStreak(p, "2026-09-27")).toBe(2);
    expect(liveStreak(p, "2026-09-28")).toBe(0);
    p = recordGame(p, game(50, "2026-09-29")).progress;
    expect(p.streak).toEqual({ day: "2026-09-29", count: 1 });
  });

  it("records an achievement once, with the day it came", () => {
    const p = unlock(emptyProgress(), ["shot25"], "2026-09-27");
    expect(p.achievements).toEqual({ shot25: "2026-09-27" });
    expect(unlock(p, ["shot25"], "2026-09-28")).toBe(p);
  });

  it("reads back what it wrote, and loses only the fields that are broken", () => {
    const p = withSettings(recordGame(emptyProgress(), game(300, "2026-09-27")).progress, {
      volume: 0.4,
      lang: "de",
    });
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
    const broken = parseProgress(
      JSON.stringify({ ...p, bestShot: "far", settings: { volume: 7, lang: "fr" } }),
    );
    expect(broken.bestTotal).toBe(300);
    expect(broken.bestShot).toBe(0);
    expect(broken.settings.volume).toBe(1);
    expect(broken.settings.lang).toBeNull();
    for (const junk of [null, "", "{", "[]", "42"]) {
      expect(parseProgress(junk)).toEqual(emptyProgress());
    }
  });

  it("forgets rather than breaks when storage throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    } as unknown as Storage;
    const store = browserStore(() => throwing);
    expect(store.load()).toEqual(emptyProgress());
    expect(() => store.save(emptyProgress())).not.toThrow();
    expect(browserStore(() => null).load()).toEqual(emptyProgress());
  });

  it("stores under one versioned key", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    } as unknown as Storage;
    const store = browserStore(() => storage);
    store.save(recordShot(emptyProgress(), 77));
    expect([...data.keys()]).toEqual([STORAGE_KEY]);
    expect(store.load().bestShot).toBe(77);
  });
});
