import { previousDay } from "@/app/daily.ts";

/**
 * What the page remembers between visits: records, the daily challenge,
 * achievements and settings. Only the page: the simulation never sees any of
 * it, and `src/sim` is barred from storage by lint rule. Everything here is a
 * pure function of the stored value so it can be tested without a browser;
 * `browserStore` is the one place that touches `localStorage`, and a storage
 * that throws - a private window, blocked site data - is a game that forgets,
 * not a game that breaks.
 */

export type Lang = "en" | "de";

export interface Settings {
  readonly sfxMuted: boolean;
  /** 0 to 1, over everything. */
  readonly volume: number;
  readonly haptics: boolean;
  /** Null follows the browser. */
  readonly lang: Lang | null;
}

export interface DailyBest {
  readonly day: string;
  /** Feet, like every score. */
  readonly total: number;
  /** The encoded run that set it - the ghost on the next try. */
  readonly run: string;
}

export interface Progress {
  readonly games: number;
  readonly bestTotal: number;
  readonly bestShot: number;
  readonly daily: DailyBest | null;
  /** Consecutive days with a finished daily challenge, ending on `day`. */
  readonly streak: { readonly day: string; readonly count: number } | null;
  /** Achievement id to the day it was earned. */
  readonly achievements: Readonly<Record<string, string>>;
  readonly settings: Settings;
}

export const STORAGE_KEY = "hamsterflight:v1";

export const DEFAULT_SETTINGS: Settings = {
  sfxMuted: false,
  volume: 1,
  haptics: true,
  lang: null,
};

export function emptyProgress(): Progress {
  return {
    games: 0,
    bestTotal: 0,
    bestShot: 0,
    daily: null,
    streak: null,
    achievements: {},
    settings: DEFAULT_SETTINGS,
  };
}

// -- parsing -------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null;
const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v);

/**
 * Whatever is stored, as a `Progress`. Field by field: one bad value - an
 * older build's, a hand edit - costs that field, not the records beside it.
 */
export function parseProgress(text: string | null): Progress {
  const empty = emptyProgress();
  if (text === null) return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty;
  }
  if (!isObject(raw)) return empty;

  const daily = isObject(raw["daily"]) ? raw["daily"] : null;
  const streak = isObject(raw["streak"]) ? raw["streak"] : null;
  const settings = isObject(raw["settings"]) ? raw["settings"] : {};
  const achievements: Record<string, string> = {};
  if (isObject(raw["achievements"])) {
    for (const [id, day] of Object.entries(raw["achievements"])) {
      if (isDay(day)) achievements[id] = day;
    }
  }
  const volume = settings["volume"];
  const lang = settings["lang"];
  return {
    games: count(raw["games"]),
    bestTotal: count(raw["bestTotal"]),
    bestShot: count(raw["bestShot"]),
    daily:
      daily !== null && isDay(daily["day"]) && typeof daily["run"] === "string"
        ? { day: daily["day"], total: count(daily["total"]), run: daily["run"] }
        : null,
    streak:
      streak !== null && isDay(streak["day"]) && count(streak["count"]) > 0
        ? { day: streak["day"], count: count(streak["count"]) }
        : null,
    achievements,
    settings: {
      sfxMuted: settings["sfxMuted"] === true,
      volume:
        typeof volume === "number" && Number.isFinite(volume)
          ? Math.min(1, Math.max(0, volume))
          : DEFAULT_SETTINGS.volume,
      haptics: settings["haptics"] !== false,
      lang: lang === "en" || lang === "de" ? lang : null,
    },
  };
}

// -- updates ---------------------------------------------------------------------

export interface GameRecord {
  readonly total: number;
  readonly shots: readonly number[];
  /** The day of the challenge this game was, or null for a free game. */
  readonly daily: string | null;
  readonly run: string;
}

export interface GameOutcome {
  readonly progress: Progress;
  readonly newBestTotal: boolean;
  readonly newBestShot: boolean;
  readonly newDailyBest: boolean;
  /** The best total before this game - what the results screen compares against. */
  readonly previousBestTotal: number;
}

/** The progress after one more finished game. */
export function recordGame(p: Progress, game: GameRecord): GameOutcome {
  const bestShot = Math.max(0, ...game.shots);
  const newBestTotal = game.total > p.bestTotal;
  const newBestShot = bestShot > p.bestShot;

  let daily = p.daily;
  let streak = p.streak;
  let newDailyBest = false;
  if (game.daily !== null) {
    const day = game.daily;
    if (daily === null || daily.day !== day || game.total > daily.total) {
      newDailyBest = true;
      daily = { day, total: game.total, run: game.run };
    }
    if (streak === null || (streak.day !== day && streak.day !== previousDay(day))) {
      streak = { day, count: 1 };
    } else if (streak.day === previousDay(day)) {
      streak = { day, count: streak.count + 1 };
    }
  }
  return {
    progress: {
      ...p,
      games: p.games + 1,
      bestTotal: Math.max(p.bestTotal, game.total),
      bestShot: Math.max(p.bestShot, bestShot),
      daily,
      streak,
    },
    newBestTotal,
    newBestShot,
    newDailyBest,
    previousBestTotal: p.bestTotal,
  };
}

/** A shot just ended; the record flag moves at once rather than at game over. */
export function recordShot(p: Progress, feet: number): Progress {
  return feet > p.bestShot ? { ...p, bestShot: feet } : p;
}

export function unlock(p: Progress, ids: readonly string[], day: string): Progress {
  const fresh = ids.filter((id) => !(id in p.achievements));
  if (fresh.length === 0) return p;
  const achievements = { ...p.achievements };
  for (const id of fresh) achievements[id] = day;
  return { ...p, achievements };
}

export function withSettings(p: Progress, change: Partial<Settings>): Progress {
  return { ...p, settings: { ...p.settings, ...change } };
}

/** The streak as it stands today: one that missed yesterday is over. */
export function liveStreak(p: Progress, today: string): number {
  const s = p.streak;
  if (s === null) return 0;
  return s.day === today || s.day === previousDay(today) ? s.count : 0;
}

// -- storage -----------------------------------------------------------------------

export interface ProgressStore {
  load(): Progress;
  save(p: Progress): void;
}

/** `localStorage`, if the browser will give it; otherwise a store that forgets. */
export function browserStore(storage: () => Storage | null = defaultStorage): ProgressStore {
  return {
    load: () => {
      try {
        return parseProgress(storage()?.getItem(STORAGE_KEY) ?? null);
      } catch {
        return emptyProgress();
      }
    },
    save: (p) => {
      try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify(p));
      } catch {
        // Full, blocked or private: this visit's progress is all there is.
      }
    },
  };
}

function defaultStorage(): Storage | null {
  // Reading the property itself throws where site data is blocked.
  return typeof localStorage === "undefined" ? null : localStorage;
}
