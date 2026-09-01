import { BlurFilter, type Container, type Filter } from 'pixi.js';
import type { Effects } from '@/render/effects/Effects.ts';
import { SceneFilter } from '@/render/effects/SceneFilter.ts';
import { altitudeOf, clamp } from '@/render/scene/decor.ts';
import { C } from '@/sim/constants.ts';
import type { SimSnapshot } from '@/sim/state.ts';

/** Below this the hamster is not moving fast enough for the smear to read. */
const MOTION_BLUR_FROM = 32;
const MOTION_BLUR_SPAN = 38;
const MOTION_BLUR_MAX = 7;
/**
 * A blur of strength ~0 is invisible but still costs the full-screen pass, so
 * it is not attached until it would show.
 */
const MOTION_BLUR_VISIBLE = 0.05;
/** Likewise the shader: at sea level it has nothing to add. */
const SHADING_VISIBLE_ALTITUDE = 0.02;

const BLUR = 1;
const SHADE = 2;

/**
 * The whole reason this backend is the default: Canvas2D has no shader path.
 *
 * Filters are attached only while they have something to do. An attached
 * filter costs a full-screen render-target ping-pong every frame whatever its
 * strength, and it breaks the single-draw-call batching the atlas buys - so
 * at rest the scene carries none at all, and the array is rebuilt only when
 * the set changes.
 */
export class SceneFilters {
  readonly #motionBlur = new BlurFilter({ strength: 0, quality: 2, resolution: 0.5 });
  readonly #sceneFilter = new SceneFilter();
  /** Which filters are attached, so the array is only rebuilt when it changes. */
  #mask = 0;

  /**
   * `offsetX`/`offsetY` are the world container's position this frame: camera
   * plus shake. The shader centres its effects on screen fractions, and the
   * filter samples the moved world, so leaving the shake out slid the centre
   * by up to five pixels during exactly the impact that raised it.
   */
  apply(
    target: Container,
    s: SimSnapshot,
    effects: Effects,
    now: number,
    offsetX: number,
    offsetY: number,
  ): void {
    const speed = clamp((Math.abs(s.hamster.xvel) - MOTION_BLUR_FROM) / MOTION_BLUR_SPAN, 0, 1);
    const altitude = altitudeOf(s);
    const aberration = effects.aberration(now);
    const wave = effects.shockwave(now);

    const blurring = effects.motion && s.phaseKind === 'flying' && speed > MOTION_BLUR_VISIBLE;
    const shading = altitude > SHADING_VISIBLE_ALTITUDE || aberration > 0 || wave !== null;

    if (blurring) {
      this.#motionBlur.strengthX = speed * MOTION_BLUR_MAX;
      // Horizontal only: the hamster travels sideways, so blurring vertically
      // would just smear the ground line.
      this.#motionBlur.strengthY = 0;
    }
    if (shading) {
      const uniforms = this.#sceneFilter.uniforms;
      uniforms.uAberration = aberration;
      uniforms.uAltitude = altitude;
      uniforms.uCentre[0] = clamp((s.hamster.x + offsetX) / C.VIEW_W, 0, 1);
      uniforms.uCentre[1] = clamp((s.hamster.y + offsetY) / C.VIEW_H, 0, 1);
      uniforms.uWaveProgress = wave?.progress ?? 0;
      uniforms.uWaveAmplitude = wave?.amplitude ?? 0;
      if (wave !== null) {
        // Held in world space, so the ring stays on the ground it came from
        // while the camera scrolls past.
        uniforms.uWaveCentre[0] = (wave.x + offsetX) / C.VIEW_W;
        uniforms.uWaveCentre[1] = (wave.y + offsetY) / C.VIEW_H;
      }
    }

    const mask = (blurring ? BLUR : 0) | (shading ? SHADE : 0);
    if (mask === this.#mask) return;
    this.#mask = mask;
    const active: Filter[] = [];
    if (blurring) active.push(this.#motionBlur);
    if (shading) active.push(this.#sceneFilter);
    target.filters = active;
  }

  destroy(target: Container): void {
    target.filters = [];
    this.#motionBlur.destroy();
    this.#sceneFilter.destroy();
  }
}
