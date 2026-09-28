import { AchievementTracker } from "@/app/achievements.ts";
import { dailySeed } from "@/app/daily.ts";
import { GhostRace } from "@/app/ghost.ts";
import { ACHIEVEMENT_IDS, type AchievementId, type Strings } from "@/app/i18n.ts";
import {
  liveStreak,
  type Progress,
  type ProgressStore,
  recordGame,
  recordShot,
  type Settings,
  unlock,
  withSettings,
} from "@/app/progress.ts";
import { decodeRun, encodeRun, type Run } from "@/app/recording.ts";
import { type Replay, replayRun } from "@/app/replay.ts";
import type { SessionStep } from "@/app/session.ts";
import type { Toasts } from "@/app/toast.ts";
import type { FlagMarker, Overlay } from "@/render/scene/overlay.ts";
import { metres } from "@/render/units.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/** What kind of game is being played - which decides the seed and the ghost. */
export type Mode =
  | { readonly kind: "free" }
  | { readonly kind: "daily"; readonly day: string; readonly ghost: Replay | null }
  | { readonly kind: "duel"; readonly ghost: Replay };

export interface MetaGameOptions {
  readonly store: ProgressStore;
  readonly strings: Strings;
  readonly toasts: Toasts;
  /** Today, as a `dayKey`. A function: the page can stay open past midnight. */
  readonly today: () => string;
  readonly randomSeed: () => number;
  /** Where a spark burst and a chime go when a flag is passed. */
  readonly celebrate: (x: number, y: number) => void;
  /** Hands a shared link to the platform; resolves to whether it was copied. */
  readonly share: (url: string, text: string) => Promise<"shared" | "copied" | "failed">;
  /** The page URL a shared run is appended to. */
  readonly baseUrl: () => string;
  readonly results: ResultsView;
  /** The list of achievements changed. */
  readonly onProgress: (p: Progress) => void;
}

/** The results panel's DOM, filled from `showResults`. */
export interface ResultsView {
  show(model: ResultsModel): void;
  hide(): void;
}

export interface ResultsModel {
  readonly title: string;
  readonly badge: string | null;
  readonly shots: readonly {
    readonly label: string;
    readonly value: string;
    readonly best: boolean;
  }[];
  readonly total: string;
  readonly notes: readonly string[];
  readonly unlocked: readonly string[];
  readonly again: string;
  readonly switchLabel: string;
  readonly share: string;
}

/**
 * Everything the port adds around a game: the record and the daily best, the
 * ghost, the achievements, the results panel. It reads the session's steps
 * and never writes to the simulation - the only way it changes a game is by
 * choosing the seed of the next one.
 */
export class MetaGame {
  readonly #o: MetaGameOptions;
  #t: Strings;
  #progress: Progress;
  #mode: Mode;
  #race: GhostRace | null;
  readonly #tracker = new AchievementTracker();
  /** Earned this game, for the results panel. */
  #earned: AchievementId[] = [];
  /** The game just finished, waiting for PLAY AGAIN to come up. */
  #pending: { run: Run; total: number; shots: readonly number[] } | null = null;
  #lastRun: { run: Run; total: number } | null = null;
  /** The game just finished beat a record that was already there. */
  #newRecord = false;
  /** The record flag as it stood when this shot left the pillow. */
  #flagFeet = 0;
  #lastX = 0;

  constructor(options: MetaGameOptions, mode: Mode) {
    this.#o = options;
    this.#t = options.strings;
    this.#progress = options.store.load();
    this.#mode = mode;
    this.#race = raceFor(mode);
    this.#flagFeet = this.#progress.bestShot;
  }

  get progress(): Progress {
    return this.#progress;
  }

  get mode(): Mode {
    return this.#mode;
  }

  /** Builds the mode for a URL: a shared run, `?daily`, or a free game. */
  static modeFor(
    params: URLSearchParams,
    progress: Progress,
    today: string,
  ): { mode: Mode; badRun: boolean } {
    const raw = params.get("run");
    if (raw !== null) {
      const run = decodeRun(raw);
      const ghost = run === null ? null : replayRun(run);
      if (ghost !== null) return { mode: { kind: "duel", ghost }, badRun: false };
      return { mode: { kind: "free" }, badRun: true };
    }
    if (params.has("daily")) return { mode: dailyMode(progress, today), badRun: false };
    return { mode: { kind: "free" }, badRun: false };
  }

  /**
   * The seed for the next game in this mode. `GameSession` asks for it on PLAY
   * AGAIN, before this sees the restart - so a daily game begun after midnight
   * has to become the new day's here, or it would play yesterday's seed.
   */
  nextSeed(): number {
    this.#refreshDay();
    const mode = this.#mode;
    if (mode.kind === "daily") return dailySeed(mode.day);
    if (mode.kind === "duel") return mode.ghost.seed;
    return this.#o.randomSeed();
  }

  updateSettings(change: Partial<Settings>): void {
    this.#save(withSettings(this.#progress, change));
  }

  setStrings(strings: Strings): void {
    this.#t = strings;
  }

  /** The toast that opens a game in this mode, if it needs one. */
  announce(): void {
    const mode = this.#mode;
    if (mode.kind === "duel") this.#o.toasts.show(this.#t.toast.duel(metres(mode.ghost.total)));
    else if (mode.kind === "daily") {
      this.#o.toasts.show(
        this.#t.toast.daily(mode.ghost === null ? null : metres(mode.ghost.total)),
      );
    }
  }

  // -- the results panel's buttons -------------------------------------------------

  /** Switch between free play and the daily challenge for the next game. */
  switchMode(): void {
    this.#mode =
      this.#mode.kind === "free" ? dailyMode(this.#progress, this.#o.today()) : { kind: "free" };
    this.#race = raceFor(this.#mode);
  }

  async share(): Promise<void> {
    const last = this.#lastRun;
    if (last === null) return;
    const url = new URL(this.#o.baseUrl());
    url.search = `?run=${encodeRun(last.run)}`;
    const result = await this.#o.share(url.toString(), this.#t.toast.shareText(metres(last.total)));
    if (result === "copied") this.#o.toasts.show(this.#t.toast.copied);
  }

  // -- per tick ---------------------------------------------------------------------

  step(result: SessionStep): void {
    const s = result.snapshot;
    if (result.restarted) this.#newGame();

    this.#race?.step(result.events, s);
    this.#earn(this.#tracker.step(result.events, s));

    for (const event of result.events) {
      if (event.t === "launched") {
        this.#flagFeet = this.#progress.bestShot;
        this.#lastX = s.hamster.x;
      } else if (event.t === "shotDone") {
        const before = this.#progress.bestShot;
        this.#save(recordShot(this.#progress, event.feet));
        if (before > 0 && event.feet > before) {
          this.#o.toasts.show(this.#t.toast.shotRecord(metres(event.feet)));
        }
      }
    }
    if (s.phaseKind === "flying" && !s.paused) this.#passFlags(s);

    if (result.finished !== null) this.#finish(result.finished);
    if (this.#pending !== null && s.restartable) this.#showResults();
  }

  /** The flags and the ghost for this frame. */
  overlay(s: SimSnapshot, alpha: number): Overlay {
    const flags: FlagMarker[] = [];
    const record = s.phaseKind === "flying" ? this.#flagFeet : this.#progress.bestShot;
    if (record > 0) {
      flags.push({
        kind: "record",
        x: record * C.PX_PER_FOOT,
        label: `${this.#t.hud.record} ${metres(record)}`,
      });
    }
    const ghostFeet = this.#race?.landing(Math.min(s.turn, C.TURNS)) ?? null;
    if (ghostFeet !== null && ghostFeet > 0 && s.phaseKind !== "gameOver") {
      flags.push({
        kind: "ghost",
        x: ghostFeet * C.PX_PER_FOOT,
        label: `${this.#t.hud.ghost} ${metres(ghostFeet)}`,
      });
    }
    return { flags, ghost: this.#race?.pose(s, alpha) ?? null };
  }

  // -- internals --------------------------------------------------------------------

  #newGame(): void {
    this.#o.results.hide();
    this.#pending = null;
    this.#earned = [];
    this.#tracker.reset();
    this.#race?.reset();
    this.announce();
  }

  /** A daily challenge left open past midnight moves on to the new day, and its best. */
  #refreshDay(): void {
    if (this.#mode.kind !== "daily" || this.#mode.day === this.#o.today()) return;
    this.#mode = dailyMode(this.#progress, this.#o.today());
    this.#race = raceFor(this.#mode);
  }

  /** A burst where the hamster passes the record or the ghost's mark. */
  #passFlags(s: SimSnapshot): void {
    const x = s.hamster.x;
    const marks: number[] = [];
    if (this.#flagFeet > 0) marks.push(this.#flagFeet * C.PX_PER_FOOT);
    const ghost = this.#race?.landing(s.turn) ?? null;
    if (ghost !== null && ghost > 0) marks.push(ghost * C.PX_PER_FOOT);
    for (const mark of marks) {
      if (this.#lastX < mark && x >= mark) this.#o.celebrate(mark, s.hamster.y);
    }
    this.#lastX = x;
  }

  #earn(ids: readonly AchievementId[]): void {
    const fresh = ids.filter((id) => !(id in this.#progress.achievements));
    if (fresh.length === 0) return;
    const unique = [...new Set(fresh)];
    this.#save(unlock(this.#progress, unique, this.#o.today()));
    for (const id of unique) {
      this.#earned.push(id);
      this.#o.toasts.show(this.#t.toast.achievement(this.#t.achievements[id][0]));
    }
    this.#o.onProgress(this.#progress);
  }

  #finish(game: { run: Run; total: number; shots: readonly number[] }): void {
    const mode = this.#mode;
    const daily = mode.kind === "daily" ? mode.day : null;
    const outcome = recordGame(this.#progress, {
      total: game.total,
      shots: game.shots,
      daily,
      run: encodeRun(game.run),
    });
    this.#save(outcome.progress);
    this.#lastRun = { run: game.run, total: game.total };
    const duelWon = mode.kind === "duel" && game.total > mode.ghost.total;
    this.#earn(
      this.#tracker.finish({
        total: game.total,
        beatRecord: outcome.newBestTotal && outcome.previousBestTotal > 0,
        daily: daily !== null,
        streak: liveStreak(this.#progress, this.#o.today()),
        duelWon,
      }),
    );
    this.#pending = game;
    this.#newRecord = outcome.newBestTotal && outcome.previousBestTotal > 0;
  }

  #showResults(): void {
    const game = this.#pending;
    if (game === null) return;
    this.#pending = null;
    const t = this.#t.results;
    const mode = this.#mode;
    const best = Math.max(...game.shots);
    const notes: string[] = [];
    if (mode.kind === "duel") {
      const gap = game.total - mode.ghost.total;
      notes.push(
        gap > 0 ? t.duelWon(metres(gap)) : gap < 0 ? t.duelLost(metres(-gap)) : t.duelTied,
      );
    }
    if (mode.kind === "daily" && this.#progress.daily !== null) {
      notes.push(t.dailyBest(metres(this.#progress.daily.total)));
      notes.push(t.streak(liveStreak(this.#progress, this.#o.today())));
    }
    notes.push(t.personalBest(metres(this.#progress.bestTotal)));

    this.#o.results.show({
      title:
        mode.kind === "daily"
          ? t.dailyTitle(mode.day)
          : mode.kind === "duel"
            ? t.duelTitle
            : t.title,
      badge: this.#newRecord ? t.newRecord : null,
      shots: game.shots.map((feet, i) => ({
        label: t.shot(i + 1),
        value: metres(feet),
        best: feet === best && feet > 0,
      })),
      total: `${t.total}: ${metres(game.total)}`,
      notes,
      unlocked: this.#earned.map((id) => this.#t.achievements[id][0]),
      again: mode.kind === "duel" ? t.rematch : t.playAgain,
      switchLabel: mode.kind === "free" ? t.daily : t.freePlay,
      share: t.share,
    });
  }

  #save(p: Progress): void {
    this.#progress = p;
    this.#o.store.save(p);
  }
}

/** Today's challenge, raced against today's own best if there is one. */
function dailyMode(progress: Progress, day: string): Mode {
  const saved = progress.daily?.day === day ? progress.daily : null;
  const run = saved === null ? null : decodeRun(saved.run);
  return { kind: "daily", day, ghost: run === null ? null : replayRun(run) };
}

function raceFor(mode: Mode): GhostRace | null {
  const ghost = mode.kind === "free" ? null : mode.ghost;
  return ghost === null ? null : new GhostRace(ghost);
}

/** Earned out of all, for the about panel's heading. */
export function achievementCount(p: Progress): { done: number; of: number } {
  return {
    done: ACHIEVEMENT_IDS.filter((id) => id in p.achievements).length,
    of: ACHIEVEMENT_IDS.length,
  };
}
