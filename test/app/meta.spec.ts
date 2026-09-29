import { describe, expect, it } from "vitest";
import { AchievementTracker } from "@/app/achievements.ts";
import { dailySeed } from "@/app/daily.ts";
import { GhostRace } from "@/app/ghost.ts";
import { vibrationFor } from "@/app/haptics.ts";
import { ACHIEVEMENT_IDS, pickLang, STRINGS } from "@/app/i18n.ts";
import { type Mode, MetaGame, type ResultsModel } from "@/app/MetaGame.ts";
import { emptyProgress, type ProgressStore } from "@/app/progress.ts";
import { encodeRun } from "@/app/recording.ts";
import type { Replay } from "@/app/replay.ts";
import { GameSession, type SessionStep } from "@/app/session.ts";
import type { Toasts } from "@/app/toast.ts";
import { HUD, HUD_TYPE } from "@/render/scene/hud.ts";
import type { InputCommand } from "@/sim/commands.ts";
import type { SimEvent } from "@/sim/events.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";
import { noEffects } from "@/sim/types.ts";

function snap(over: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    tick: 0,
    phaseKind: "flying",
    turn: 1,
    paused: false,
    swung: false,
    windup: null,
    walkOut: null,
    hamster: { x: 0, y: 0, xvel: 0, yvel: 0, visible: true, doRotation: true, rotationDeg: 0 },
    camera: { x: 0, y: 0 },
    powerups: [],
    glidePoints: 0,
    flags: noEffects(),
    balls: [],
    shots: [],
    feet: 0,
    outcome: null,
    outcomeClip: null,
    restartable: false,
    ...over,
  };
}

describe("languages", () => {
  it("has every word in both", () => {
    const shape = (v: unknown): unknown =>
      typeof v === "object" && v !== null
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]))
        : typeof v;
    expect(shape(STRINGS.de)).toEqual(shape(STRINGS.en));
    expect(Object.keys(STRINGS.en.achievements).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
  });

  it("follows ?lang=, then the saved choice, then the browser", () => {
    expect(pickLang("de", "en", ["en-US"])).toBe("de");
    expect(pickLang(null, "en", ["de-DE"])).toBe("en");
    expect(pickLang(null, null, ["fr-FR", "de-AT"])).toBe("de");
    expect(pickLang("xx", null, ["fr"])).toBe("en");
  });

  it("keeps every section of the top bar inside its room, in every language", () => {
    // Fredoka 600 sets figures at about 0.5 em and capitals at about 0.62 em;
    // a label also carries its letter spacing. Generous estimates, so a word
    // that fails here is too long in the real face as well.
    const { bar, dividers, tries, meter, panel, glide } = HUD;
    const capitals = (text: string): number =>
      text.length * (0.66 * HUD_TYPE.label.size + HUD_TYPE.label.letterSpacing);
    const figures = (text: string, size: number): number => text.length * 0.55 * size;
    const [d1, d2, d3] = dividers;
    const [a, b] = panel.columns;
    const right = bar.x + bar.w - 8;
    for (const t of Object.values(STRINGS)) {
      const h = t.hud;
      expect(tries.labelX + capitals(`${h.triesLabel} 5/5`), h.triesLabel).toBeLessThan(d1 - 4);
      expect(tries.pipX + 5 * tries.pipStep).toBeLessThan(d1 - 2);
      expect(meter.labelX + capitals(h.launchLabel), h.launchLabel).toBeLessThan(d2 - 4);
      expect(meter.x + meter.w).toBeLessThan(d2 - 4);
      expect(a + capitals(h.distanceLabel)).toBeLessThan(b - 6);
      expect(a + figures("999.99 m", HUD_TYPE.value.size)).toBeLessThan(b - 6);
      expect(b + capitals(h.totalLabel)).toBeLessThan(d3 - 4);
      expect(b + figures("9999.99 m", HUD_TYPE.sub.size)).toBeLessThan(d3 - 4);
      expect(glide.labelX + capitals(h.glide)).toBeLessThan(right);
    }
    expect(glide.x + glide.w).toBeLessThanOrEqual(right + 2);
    expect(bar.x + bar.w).toBeLessThanOrEqual(600);
  });
});

describe("achievements", () => {
  const shot = (feet: number, outcome: "cheer" | "faceplant" = "cheer"): SimEvent => ({
    t: "shotDone",
    feet,
    outcome,
  });

  it("counts cheers across a game and distances per shot", () => {
    const a = new AchievementTracker();
    expect(a.step([shot(90)], snap())).toEqual(["firstCheer", "shot25"]);
    a.step([shot(10, "faceplant")], snap());
    a.step([shot(10)], snap());
    expect(a.step([shot(10)], snap())).toContain("cheers3");
    a.reset();
    expect(a.step([shot(10)], snap())).not.toContain("cheers3");
  });

  it("wants speed and wind in the same flight", () => {
    const a = new AchievementTracker();
    const pickup = (kind: "speed" | "wind"): SimEvent => ({ t: "pickup", kind });
    expect(a.step([pickup("speed")], snap())).toEqual([]);
    a.step([{ t: "launched", vel: 1, angleDeg: 1 }], snap());
    expect(a.step([pickup("wind")], snap())).toEqual([]);
    expect(a.step([pickup("speed")], snap())).toEqual(["speedWind"]);
  });

  it("sees two balls held at once", () => {
    const a = new AchievementTracker();
    expect(a.step([], snap({ balls: ["bounce", "superbounce"] }))).toEqual(["stack2"]);
  });

  it("judges the whole game at the end", () => {
    const a = new AchievementTracker();
    expect(
      a.finish({ total: 900, beatRecord: true, daily: true, streak: 3, duelWon: true }),
    ).toEqual(["total150", "total250", "record", "daily", "streak3", "duelWon"]);
  });
});

describe("the ghost", () => {
  const replay: Replay = {
    seed: 1,
    total: 30,
    shots: [10, 20, 0, 0, 0],
    traces: [
      {
        feet: 10,
        points: [
          { x: 100, y: 0, rotationDeg: 5, pose: "hamster/fly" },
          { x: 110, y: 10, rotationDeg: 6, pose: "hamster/glide" },
        ],
      },
      { feet: 20, points: [{ x: 500, y: 0, rotationDeg: 0, pose: "hamster/fly" }] },
    ],
  };

  it("leaves the pillow when the player does, and flies tick for tick", () => {
    const race = new GhostRace(replay);
    expect(race.pose(snap({ tick: 40 }), 0)).toBeNull();
    race.step([{ t: "launched", vel: 1, angleDeg: 1 }], snap({ tick: 40 }));
    expect(race.pose(snap({ tick: 41 }), 0)).toMatchObject({ x: 100, pose: "hamster/fly" });
    expect(race.pose(snap({ tick: 41 }), 0.5)).toMatchObject({ x: 105, y: 5 });
    expect(race.pose(snap({ tick: 41 }), 1)).toMatchObject({ x: 110, pose: "hamster/glide" });
    // Its shot is over before the player's: it has landed, and the flag shows where.
    expect(race.pose(snap({ tick: 50 }), 0)).toBeNull();
    expect(race.landing(1)).toBe(10);
  });

  it("stays on the pad until the player's shot of the same number", () => {
    const race = new GhostRace(replay);
    race.step([{ t: "launched", vel: 1, angleDeg: 1 }], snap({ tick: 5 }));
    race.step([], snap({ tick: 90, phaseKind: "ready", turn: 2 }));
    expect(race.pose(snap({ tick: 91, turn: 2 }), 0)).toBeNull();
    race.step([{ t: "launched", vel: 1, angleDeg: 1 }], snap({ tick: 120, turn: 2 }));
    expect(race.pose(snap({ tick: 121, turn: 2 }), 0)).toMatchObject({ x: 500 });
  });
});

describe("haptics", () => {
  it("buzzes for the moments that land, and not for a flight going well", () => {
    expect(vibrationFor([])).toBe(0);
    expect(vibrationFor([{ t: "launched", vel: 1, angleDeg: 1 }])).toBeGreaterThan(0);
    expect(vibrationFor([{ t: "shotDone", feet: 1, outcome: "cheer" }])).toBe(0);
    expect(vibrationFor([{ t: "shotDone", feet: 1, outcome: "hole" }])).toBeGreaterThan(0);
  });
});

describe("MetaGame, over a real session", () => {
  function play(session: GameSession, meta: MetaGame, onFlying?: (s: SimSnapshot) => void): number {
    let jumpTicks = 0;
    let attempt = 0;
    for (let i = 0; i < 40_000; i++) {
      const s = session.snapshot;
      const c: InputCommand[] = [];
      if (s.phaseKind === "ready" && s.walkOut === null) {
        c.push({ kind: "press" }, { kind: "confirm" }, { kind: "release" });
        jumpTicks = 0;
        attempt++;
      } else if (
        s.phaseKind === "jumping" &&
        s.windup === null &&
        !s.swung &&
        // Just after lift-off, where the pillow always connects - varied, in case.
        ++jumpTicks >= 2 + (attempt % 3)
      ) {
        c.push({ kind: "press" }, { kind: "release" });
      } else if (s.phaseKind === "flying") {
        if (s.tick % 30 === 0) c.push({ kind: "press" });
        else if (s.tick % 30 === 10) c.push({ kind: "release" });
      }
      const result = session.step(c);
      meta.step(result);
      if (result.snapshot.phaseKind === "flying") onFlying?.(result.snapshot);
      if (result.finished !== null) return result.finished.total;
    }
    throw new Error("the game never ended");
  }

  function metaGame(
    store: ProgressStore,
    mode: Mode,
    shown: ResultsModel[] = [],
    today: () => string = () => "2026-09-27",
  ): MetaGame {
    return new MetaGame(
      {
        store,
        strings: STRINGS.en,
        toasts: { show: () => undefined } as unknown as Toasts,
        today,
        randomSeed: () => 4,
        celebrate: () => undefined,
        share: async () => "copied",
        baseUrl: () => "https://example.test/",
        results: { show: (m) => shown.push(m), hide: () => undefined },
        onProgress: () => undefined,
      },
      mode,
    );
  }

  function memoryStore(): ProgressStore {
    let saved = emptyProgress();
    return { load: () => saved, save: (p) => (saved = p) };
  }

  it("flies the ghost exactly where the same inputs fly the player", () => {
    const store = memoryStore();
    const first = new GameSession({ seed: 777, nextSeed: () => 1, tuning: DEFAULT_TUNING });
    const firstMeta = metaGame(store, { kind: "free" });
    let run: string | null = null;
    firstMeta.step = ((original) => (r: SessionStep) => {
      if (r.finished !== null) run = encodeRun(r.finished.run);
      original(r);
    })(firstMeta.step.bind(firstMeta));
    const total = play(first, firstMeta);

    const { mode } = MetaGame.modeFor(new URLSearchParams(`run=${run}`), emptyProgress(), "x");
    expect(mode.kind).toBe("duel");
    const meta = metaGame(memoryStore(), mode);
    const session = new GameSession({
      seed: meta.nextSeed(),
      nextSeed: () => 1,
      tuning: DEFAULT_TUNING,
    });
    let seen = 0;
    const again = play(session, meta, (s) => {
      const ghost = meta.overlay(s, 1).ghost;
      expect(ghost).not.toBeNull();
      expect(ghost?.x).toBeCloseTo(s.hamster.x, 6);
      expect(ghost?.y).toBeCloseTo(s.hamster.y, 6);
      seen++;
    });
    expect(again).toBe(total);
    expect(seen).toBeGreaterThan(50);
  });

  it("plays the new day's seed when a daily game is replayed after midnight", () => {
    let day = "2026-09-27";
    const store = memoryStore();
    const { mode } = MetaGame.modeFor(new URLSearchParams("daily"), emptyProgress(), day);
    const meta = metaGame(store, mode, [], () => day);
    const session = new GameSession({
      seed: meta.nextSeed(),
      nextSeed: () => meta.nextSeed(),
      tuning: DEFAULT_TUNING,
    });
    expect(session.seed).toBe(dailySeed("2026-09-27"));
    play(session, meta);
    for (let i = 0; i < 200 && !session.snapshot.restartable; i++) meta.step(session.step([]));
    day = "2026-09-28";
    const restart = session.step([{ kind: "confirm" }]);
    meta.step(restart);
    expect(restart.restarted).toBe(true);
    expect(session.seed).toBe(dailySeed("2026-09-28"));
    expect(meta.mode).toMatchObject({ kind: "daily", day: "2026-09-28", ghost: null });
  });

  it("plants the record flag and shows the results once PLAY AGAIN is up", () => {
    const store = memoryStore();
    const shown: ResultsModel[] = [];
    const meta = metaGame(store, { kind: "free" }, shown);
    const session = new GameSession({ seed: 5, nextSeed: () => 6, tuning: DEFAULT_TUNING });
    const total = play(session, meta);
    expect(shown).toHaveLength(0);
    for (let i = 0; i < 200 && shown.length === 0; i++) meta.step(session.step([]));
    expect(shown).toHaveLength(1);
    expect(shown[0]?.shots).toHaveLength(5);
    expect(store.load().bestTotal).toBe(total);
    const flags = meta.overlay(session.snapshot, 0).flags;
    expect(flags.map((f) => f.kind)).toEqual(["record"]);
    expect(flags[0]?.x).toBe(store.load().bestShot * 100);
  });
});
