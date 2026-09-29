import type { AssetBundle } from "@/assets/AssetLoader.ts";
import type { Effects } from "@/render/effects/Effects.ts";
import type { HudStrings } from "@/render/scene/hud.ts";
import type { Overlay } from "@/render/scene/overlay.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import type { Tuning } from "@/sim/tuning.ts";

export interface RendererOptions {
  /** Draw the measured hitboxes over the art. */
  readonly showHitboxes?: boolean;
  /**
   * The boxes the simulation is actually running with, for the hitbox overlay.
   * Defaults to `DEFAULT_TUNING`; pass the real one or the overlay lies.
   */
  readonly tuning?: Tuning;
  /**
   * Decoration multiplier, for profiling only. 1 is the real game.
   *
   * It scales what the *renderer* invents - bush density, star count and how
   * many times each powerup is drawn - and never the simulation, so the
   * trajectory for a given seed is identical at every setting. Both renderers
   * implement it the same way, which is the point: at the real load both sit
   * in the noise, and only a sweep shows where the crossover is.
   */
  readonly stress?: number;
  /** The primary pointer is a finger: the prompts say "tap", not "click". */
  readonly touch?: boolean;
  /** The words on the canvas. English when not given. */
  readonly strings?: HudStrings;
}

/**
 * What the game needs from a renderer, and nothing more.
 *
 * The contract is one-way in the same sense the Canvas2D renderer already was:
 * an implementation receives a `SimSnapshot` and cannot reach the simulation.
 */
export interface Renderer {
  /**
   * `overlay` is what the page adds over the original's picture - the record
   * flag, the ghost. It comes from outside the snapshot because the
   * simulation knows nothing of either.
   */
  draw(s: SimSnapshot, now: number, overlay?: Overlay): void;
  resize(): void;
  /** The tab was hidden: do not count the time away as animation time. */
  resync(): void;
  toggleHitboxes(): void;
  /** The language changed. */
  setStrings(strings: HudStrings): void;
  /**
   * A denser atlas arrived - the stage grew past what the first one covers,
   * full screen or a sharper monitor. Same layout, more pixels per frame.
   */
  setAssets(assets: AssetBundle): void;
  destroy(): void;
}

/**
 * Both backends are built through this signature. It is async because Pixi's
 * `Application.init()` is, and a constructor cannot await.
 */
export type RendererFactory = (
  canvas: HTMLCanvasElement,
  assets: AssetBundle,
  effects: Effects,
  options?: RendererOptions,
) => Promise<Renderer>;
