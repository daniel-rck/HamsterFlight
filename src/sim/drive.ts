import type { InputCommand } from "./commands.ts";
import { Simulation } from "./Simulation.ts";
import type { SimSnapshot } from "./state.ts";
import { DEFAULT_TUNING, type Tuning } from "./tuning.ts";
import type { ShotOutcome } from "./types.ts";

/**
 * Plays whole shots against the real engine under a scripted button policy.
 *
 * The successor to `reference/legacy/sim.js`, and the one driver behind both
 * the golden tests and `scripts/bench-strategies.ts` - they used to carry two
 * copies with different tick budgets, so the bench and the tests could quietly
 * disagree about which shots ever ended. It lives in `src/sim` because it is
 * pure: a seed, a click tick and a policy in, a result out.
 */

/** A hold policy decides, per tick, whether the button is down. */
export type HoldPolicy = (s: SimSnapshot) => boolean;

/** Never touch the button. */
export const never: HoldPolicy = () => false;
/** Hold whenever there is any glide left - what the analysis called "mash". */
export const hold: HoldPolicy = (s) => s.glidePoints > 0;
/** Actually mash: press on alternate ticks while there is glide left. */
export const mash: HoldPolicy = (s) => s.glidePoints > 0 && s.tick % 2 === 0;
/** Hold only while not already climbing hard - the analysis's "smart" strategy. */
export const smart: HoldPolicy = (s) => s.glidePoints > 0 && s.hamster.yvel > -5;

export interface ShotResult {
  readonly feet: number;
  /** `miss` when the second click never connected; the shot then never flew. */
  readonly outcome: ShotOutcome | "miss";
  readonly ticks: number;
  /** Highest point reached, in px above the launch height. */
  readonly peakUp: number;
  /** True when `maxTicks` ran out before the shot ended - the result is partial. */
  readonly truncated: boolean;
}

export interface ShotOptions {
  readonly seed: number;
  /** Ticks between the jump press and the swing press. */
  readonly clickTick: number;
  readonly hold?: HoldPolicy;
  readonly tuning?: Tuning;
  readonly maxTicks?: number;
}

/** Long enough for any shot that ends; a hold-forever flight into space does not. */
export const DEFAULT_MAX_TICKS = 8000;

/**
 * Press to jump, wait `clickTick` ticks, press again to hit the pillow, then
 * fly under `hold` until the shot is over.
 */
export function runShot(options: ShotOptions): ShotResult {
  const sim = new Simulation({ seed: options.seed, tuning: options.tuning ?? DEFAULT_TUNING });
  const policy = options.hold ?? never;
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;

  sim.step([{ kind: "press" }, { kind: "release" }]);
  for (let t = 0; t < options.clickTick && sim.phaseKind === "jumping"; t++) sim.step();

  if (sim.phaseKind !== "jumping") {
    // The hamster came back down before `clickTick`. The simulation hands the
    // turn back rather than scoring it, so this is the driver saying "no shot",
    // not an outcome the game produced.
    return { feet: 0, outcome: "zero", ticks: sim.tick, peakUp: 0, truncated: false };
  }

  const launchEvents = sim.step([{ kind: "press" }, { kind: "release" }]);
  if (launchEvents.some((e) => e.t === "missed")) {
    return { feet: 0, outcome: "miss", ticks: sim.tick, peakUp: 0, truncated: false };
  }

  const launchY = sim.snapshot().hamster.y;
  let minY = launchY;
  let down = false;
  let feet = 0;
  let outcome: ShotOutcome | null = null;

  for (let t = 0; t < maxTicks && outcome === null; t++) {
    const snap = sim.snapshot();
    if (snap.hamster.y < minY) minY = snap.hamster.y;

    const want = policy(snap);
    const commands: InputCommand[] = [];
    if (want && !down) commands.push({ kind: "press" });
    else if (!want && down) commands.push({ kind: "release" });
    down = want;

    for (const ev of sim.step(commands)) {
      if (ev.t === "shotDone") {
        feet = ev.feet;
        outcome = ev.outcome;
      }
    }
  }

  return {
    feet,
    outcome: outcome ?? "cheer",
    ticks: sim.tick,
    peakUp: Math.round(launchY - minY),
    truncated: outcome === null,
  };
}

/** The best connecting shot for a seed, sweeping the click window a player would. */
export function bestShot(
  seed: number,
  policy: HoldPolicy,
  tuning: Tuning = DEFAULT_TUNING,
): ShotResult | null {
  let best: ShotResult | null = null;
  for (let clickTick = 3; clickTick <= 26; clickTick++) {
    const r = runShot({ seed, clickTick, hold: policy, tuning });
    if (r.outcome === "miss") continue;
    if (best === null || r.feet > best.feet) best = r;
  }
  return best;
}

/** The lower median for even counts, so the value is always one that occurred. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1] ?? Number.NaN;
}
