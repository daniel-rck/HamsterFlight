import type { AssetBundle } from '@/assets/AssetLoader.ts';
import type { Effects } from '@/render/effects/Effects.ts';
import type { SimSnapshot } from '@/sim/state.ts';

export interface RendererOptions {
  /** Draw the measured hitboxes over the art. */
  readonly showHitboxes?: boolean;
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
}

/**
 * What the game needs from a renderer, and nothing more.
 *
 * The contract is one-way in the same sense the Canvas2D renderer already was:
 * an implementation receives a `SimSnapshot` and cannot reach the simulation.
 */
export interface Renderer {
  draw(s: SimSnapshot, now: number): void;
  resize(): void;
  toggleHitboxes(): void;
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
