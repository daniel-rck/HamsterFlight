import type { AchievementId } from "@/app/i18n.ts";
import { feetToMetres } from "@/render/units.ts";
import type { SimEvent } from "@/sim/events.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/**
 * Goals beyond the score, read off the event stream the renderers and the
 * audio already get. The thresholds sit where `bun run bench` puts the game:
 * a median shot flies 20-35 m and the best of 300 seeds about 90 m, so 25 m
 * is a good shot, 50 m a great one and 75 m rare.
 */

/** What the page knows about a game once it is over. */
export interface GameContext {
  readonly total: number;
  readonly beatRecord: boolean;
  readonly daily: boolean;
  readonly streak: number;
  readonly duelWon: boolean;
}

const SHOT_GOALS: readonly [AchievementId, number][] = [
  ["shot25", 25],
  ["shot50", 50],
  ["shot75", 75],
];

const TOTAL_GOALS: readonly [AchievementId, number][] = [
  ["total150", 150],
  ["total250", 250],
];

export class AchievementTracker {
  #cheers = 0;
  #flightPickups = new Set<string>();

  /**
   * One tick's events and the snapshot after them. Returns what was earned on
   * this tick; the caller decides which of those are new to the player.
   */
  step(events: readonly SimEvent[], s: SimSnapshot): AchievementId[] {
    const out: AchievementId[] = [];
    for (const event of events) {
      if (event.t === "launched") {
        this.#flightPickups.clear();
      } else if (event.t === "pickup") {
        this.#flightPickups.add(event.kind);
        if (event.kind === "superbounce") out.push("goldBall");
        if (this.#flightPickups.has("speed") && this.#flightPickups.has("wind")) {
          out.push("speedWind");
        }
      } else if (event.t === "shotDone") {
        if (event.outcome === "cheer") {
          this.#cheers++;
          out.push("firstCheer");
          if (this.#cheers >= 3) out.push("cheers3");
          if (this.#cheers >= 5) out.push("perfect");
        }
        const metres = feetToMetres(event.feet);
        for (const [id, goal] of SHOT_GOALS) if (metres >= goal) out.push(id);
      }
    }
    if (s.phaseKind === "flying" && s.balls.length >= 2) out.push("stack2");
    return out;
  }

  /** The game ended: the goals that need the whole of it. */
  finish(game: GameContext): AchievementId[] {
    const out: AchievementId[] = [];
    const metres = feetToMetres(game.total);
    for (const [id, goal] of TOTAL_GOALS) if (metres >= goal) out.push(id);
    if (game.beatRecord) out.push("record");
    if (game.daily) out.push("daily");
    if (game.streak >= 3) out.push("streak3");
    if (game.duelWon) out.push("duelWon");
    return out;
  }

  /** A new game: the per-game counts start again. */
  reset(): void {
    this.#cheers = 0;
    this.#flightPickups.clear();
  }
}
