import type { Replay } from "@/app/replay.ts";
import type { GhostPose } from "@/render/scene/overlay.ts";
import type { SimEvent } from "@/sim/events.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/**
 * A replayed game flown alongside the player's, shot for shot.
 *
 * The two games do not share a clock: the player may linger on the pad or
 * miss a swing, the ghost did whatever it did. So each ghost shot starts when
 * the player's shot of the same number leaves the pillow, and runs tick for
 * tick from there - a race from the same starting gun, with the pause button
 * freezing both because it freezes the tick.
 */
export class GhostRace {
  readonly replay: Replay;
  #launchTick: number | null = null;
  #turn = 0;

  constructor(replay: Replay) {
    this.replay = replay;
  }

  /** Feed each tick's events and the snapshot after them. */
  step(events: readonly SimEvent[], s: SimSnapshot): void {
    for (const event of events) {
      if (event.t === "launched") {
        this.#launchTick = s.tick;
        this.#turn = s.turn;
      }
    }
    if (s.phaseKind === "ready" || s.phaseKind === "gameOver") this.#launchTick = null;
  }

  /** A new game against the same ghost. */
  reset(): void {
    this.#launchTick = null;
    this.#turn = 0;
  }

  /** Where the ghost's shot for this turn came down, in feet; null past the fifth. */
  landing(turn: number): number | null {
    return this.replay.traces[turn - 1]?.feet ?? null;
  }

  /**
   * Where to draw the ghost for a frame `alpha` of the way from the previous
   * tick to `s` - the same instant `interpolate()` draws the player at.
   */
  pose(s: SimSnapshot, alpha: number): GhostPose | null {
    if (this.#launchTick === null || s.turn !== this.#turn) return null;
    if (s.phaseKind !== "flying" && s.phaseKind !== "settling") return null;
    const points = this.replay.traces[this.#turn - 1]?.points ?? [];
    const at = Math.max(0, s.tick - 1 + Math.min(1, Math.max(0, alpha)) - this.#launchTick);
    const i = Math.floor(at);
    const a = points[i];
    if (a === undefined) return null;
    const b = points[i + 1] ?? a;
    const t = at - i;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      rotationDeg: a.rotationDeg,
      pose: a.pose,
    };
  }
}
