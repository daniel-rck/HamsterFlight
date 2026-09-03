import type { AssetBundle, Sprite } from '@/assets/AssetLoader.ts';
import type { Effects } from '@/render/effects/Effects.ts';
import type { PreLaunchLayout } from '@/render/PreLaunchScene.ts';
import type { Renderer, RendererOptions } from '@/render/Renderer.ts';
import { stageScale } from '@/render/resolution.ts';
import {
  altitudeOf,
  BUBBLE_ALPHA,
  bushes,
  GROUND,
  markers,
  POWERUP_IDLE_FRAME,
  POWERUP_SPRITE,
  rgbCss,
  SHADOW_ALPHA,
  SHADOW_MIN_SCALE,
  shadowScale,
  skyColours,
  starField,
} from '@/render/scene/decor.ts';
import {
  debugLines,
  FONTS,
  glideFill,
  HUD,
  HUD_COLOURS,
  panelLines,
  promptFor,
} from '@/render/scene/hud.ts';
import { bottomCrop, hamsterRotation, outcomeOffsetY, poseFor } from '@/render/scene/pose.ts';
import { C } from '@/sim/constants.ts';
import type { SimSnapshot } from '@/sim/state.ts';
import { DEFAULT_TUNING, type Tuning } from '@/sim/tuning.ts';

const CHROME = `rgba(12,20,30,${HUD_COLOURS.chromeAlpha})`;
const PROMPT_CHROME = `rgba(12,20,30,${HUD_COLOURS.promptAlpha})`;
const MARKER_INK = `rgba(255,255,255,${HUD_COLOURS.markerAlpha})`;

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/**
 * Canvas 2D renderer for the 600x400 stage.
 *
 * It reads a `SimSnapshot` and nothing else, so it cannot influence physics.
 * Sprite placement comes entirely from the generated manifest's `ox`/`oy`,
 * which are the offsets Flash itself used - there are no per-sprite magic
 * numbers in here. What to draw is decided in `src/render/scene`; this file
 * only puts it down in immediate mode.
 */
export class GameRenderer implements Renderer {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #canvas: HTMLCanvasElement;
  readonly #assets: AssetBundle;
  readonly #effects: Effects;
  readonly #tuning: Tuning;
  readonly #stress: number;
  #dpr = 1;
  #showHitboxes: boolean;
  /** Wall-clock milliseconds, for animations that are not physics. */
  #elapsed = 0;
  #lastFrameTime = 0;

  constructor(
    canvas: HTMLCanvasElement,
    assets: AssetBundle,
    effects: Effects,
    options: RendererOptions = {},
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('2D canvas context unavailable');
    this.#ctx = ctx;
    this.#canvas = canvas;
    this.#assets = assets;
    this.#effects = effects;
    this.#tuning = options.tuning ?? DEFAULT_TUNING;
    this.#showHitboxes = options.showHitboxes ?? false;
    this.#stress = Math.max(1, Math.floor(options.stress ?? 1));
    this.resize();
  }

  resize(): void {
    this.#dpr = stageScale(this.#canvas.getBoundingClientRect().width, window.devicePixelRatio);
    this.#canvas.width = Math.round(C.VIEW_W * this.#dpr);
    this.#canvas.height = Math.round(C.VIEW_H * this.#dpr);
    this.#ctx.imageSmoothingQuality = 'high';
  }

  resync(): void {
    this.#lastFrameTime = 0;
  }

  toggleHitboxes(): void {
    this.#showHitboxes = !this.#showHitboxes;
  }

  /** Immediate mode holds no GPU objects, so there is nothing to release. */
  destroy(): void {}

  draw(s: SimSnapshot, now: number): void {
    if (this.#lastFrameTime !== 0) this.#elapsed += now - this.#lastFrameTime;
    this.#lastFrameTime = now;

    const ctx = this.#ctx;
    const d = this.#dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);

    this.#sky(ctx, s);

    // World space. The camera offsets are the original's negative container
    // offsets, so they apply directly as a translation. Impact shake rides on
    // top of them, so the HUD and the sky stay still while the world jolts.
    const shake = this.#effects.shakeOffset(now);
    ctx.setTransform(d, 0, 0, d, (s.camera.x + shake.x) * d, (s.camera.y + shake.y) * d);
    const scene = this.#effects.scene.layout(s, now);
    this.#ground(ctx, s, scene);
    this.#powerups(ctx, s);
    this.#fx(ctx, now);
    this.#particles(ctx, now);
    this.#hamster(ctx, s);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.#hud(ctx, s, scene);
  }

  // -- layers ---------------------------------------------------------------

  #sky(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    const sky = skyColours(altitudeOf(s));
    const gradient = ctx.createLinearGradient(0, 0, 0, C.VIEW_H);
    gradient.addColorStop(0, rgbCss(sky.top));
    gradient.addColorStop(1, rgbCss(sky.bottom));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);

    if (sky.starAlpha > 0) {
      ctx.globalAlpha = sky.starAlpha;
      ctx.fillStyle = '#fff';
      for (const star of starField(this.#stress)) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  #ground(ctx: CanvasRenderingContext2D, s: SimSnapshot, scene: PreLaunchLayout): void {
    ctx.fillStyle = hex(GROUND.colour);
    ctx.fillRect(GROUND.x, C.GROUND_Y, GROUND.width, GROUND.height);
    ctx.fillStyle = hex(GROUND.lipColour);
    ctx.fillRect(GROUND.x, C.GROUND_Y, GROUND.width, GROUND.lip);

    for (const bush of bushes(s.camera.x, this.#stress)) {
      const sprite = this.#assets.get(bush.sprite);
      if (sprite !== undefined) this.#blit(ctx, sprite, 0, bush.x, bush.y);
    }

    for (const at of scene.world) {
      const sprite = this.#assets.get(at.sprite);
      if (sprite !== undefined) this.#blit(ctx, sprite, at.frame, at.x, at.y);
    }

    const marks = markers(s.camera.x, this.#effects.enhanced);
    ctx.fillStyle = MARKER_INK;
    ctx.font = FONTS.marker;
    for (const x of marks.ticks) ctx.fillRect(x, C.GROUND_Y - 7, 1, 7);
    for (const label of marks.labels) ctx.fillText(label.text, label.x + 3, C.GROUND_Y - 10);
  }

  /** Impact clips, behind the hamster so it stays readable through them. */
  #fx(ctx: CanvasRenderingContext2D, now: number): void {
    for (const fx of this.#effects.active(now)) {
      const sprite = this.#assets.get(fx.sprite);
      if (sprite !== undefined) this.#blit(ctx, sprite, fx.frame, fx.x, fx.y);
    }
  }

  /** Skid grit and pickup sparks, fading as they age. */
  #particles(ctx: CanvasRenderingContext2D, now: number): void {
    for (const p of this.#effects.particles(now)) {
      ctx.globalAlpha = 1 - p.age;
      ctx.fillStyle = hex(p.tint);
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  #powerups(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    for (const item of s.powerups) {
      const sprite = this.#assets.get(POWERUP_SPRITE[item.kind]);
      if (sprite === undefined) continue;
      ctx.globalAlpha = item.taken ? 0.25 : 1;
      for (let i = 0; i < this.#stress; i++) {
        this.#blit(ctx, sprite, POWERUP_IDLE_FRAME, item.x + i * 3, item.y + i * 3);
      }
      ctx.globalAlpha = 1;

      if (this.#showHitboxes) {
        const box = this.#tuning.boxes.powerups[item.kind];
        ctx.strokeStyle = hex(HUD_COLOURS.hitboxPowerup);
        ctx.lineWidth = 1;
        ctx.strokeRect(item.x + box.cx - box.hw, item.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
      }
    }
  }

  #hamster(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    const h = s.hamster;
    if (!h.visible && s.phaseKind !== 'settling') return;

    const shadow = this.#assets.get('shadow');
    // `blt.shadClip._visible = false` on every arm that ends a shot -
    // Game.as:870, 876, 969 - so the outcome clip casts none.
    const scale = s.phaseKind === 'settling' ? 0 : shadowScale(h.y);
    if (shadow !== undefined && scale > SHADOW_MIN_SCALE) {
      ctx.save();
      ctx.translate(h.x, C.SHADOW_Y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = SHADOW_ALPHA;
      this.#blit(ctx, shadow, 0, 0, 0);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    const id = poseFor(s);
    const sprite = this.#assets.get(id);
    if (sprite === undefined) return;

    ctx.save();
    ctx.translate(h.x, h.y + outcomeOffsetY(s));
    // The bubble is opaque in the original, so the hamster vanishes inside it
    // for the whole bounce. Enhanced mode draws the flier underneath and lets
    // the bubble sit over it.
    const inBubble = id === 'hamster/ball' && this.#effects.enhanced;
    if (inBubble) {
      const inside = this.#assets.get('hamster/fly');
      if (inside !== undefined)
        this.#blit(ctx, inside, this.#effects.poses.innerFrame(inside.meta, this.#elapsed), 0, 0);
      ctx.globalAlpha = BUBBLE_ALPHA;
    }
    const rotation = hamsterRotation(s);
    if (rotation !== 0) ctx.rotate(rotation);
    this.#blit(
      ctx,
      sprite,
      this.#effects.poses.frame(s, sprite.meta, this.#elapsed),
      0,
      0,
      bottomCrop(s),
    );
    if (inBubble) ctx.globalAlpha = 1;
    ctx.restore();

    if (this.#showHitboxes) {
      const box =
        s.phaseKind === 'flying'
          ? this.#tuning.boxes.hamsterFlightCore
          : this.#tuning.boxes.hamsterJumpCore;
      ctx.strokeStyle = hex(HUD_COLOURS.hitboxHamster);
      ctx.lineWidth = 1;
      ctx.strokeRect(h.x + box.cx - box.hw, h.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
    }
  }

  /**
   * Cuts one frame out of the atlas sheet and places it by the manifest
   * offsets. `w`/`h` are art pixels and `ox`/`oy` stage pixels, so the frame is
   * drawn at its stage size - which is how art packed above 1:1 stays put.
   */
  /**
   * `cropBottom` is in stage px and leaves that much off the bottom of the
   * frame - `bottomCrop`, for the shadow painted into the jump clip. `ox`/`oy`
   * place the top-left, so a shorter frame lands in exactly the same place.
   */
  #blit(
    ctx: CanvasRenderingContext2D,
    sprite: Sprite,
    frame: number,
    x: number,
    y: number,
    cropBottom = 0,
  ): void {
    const rect = sprite.frames[frame] ?? sprite.frames[0];
    if (rect === undefined) return;
    const density = sprite.density;
    const height = rect.h - cropBottom * density;
    if (height <= 0) return;
    ctx.drawImage(
      sprite.sheet,
      rect.x,
      rect.y,
      rect.w,
      height,
      x + sprite.meta.ox,
      y + sprite.meta.oy,
      rect.w / density,
      height / density,
    );
  }

  // -- HUD ------------------------------------------------------------------

  #hud(ctx: CanvasRenderingContext2D, s: SimSnapshot, scene: PreLaunchLayout): void {
    for (const at of scene.hud) {
      const sprite = this.#assets.get(at.sprite);
      if (sprite !== undefined) this.#blit(ctx, sprite, at.frame, at.x, at.y);
    }
    const needle = scene.needle;
    const arrow = needle === null ? undefined : this.#assets.get(needle.sprite);
    if (needle !== null && arrow !== undefined) {
      ctx.save();
      ctx.translate(needle.x, needle.y);
      if (needle.flipped) ctx.rotate(Math.PI);
      this.#blit(ctx, arrow, needle.frame, 0, 0);
      ctx.restore();
    }

    ctx.font = FONTS.hud;

    const metric = this.#effects.enhanced;
    const panel = HUD.panel;
    ctx.fillStyle = CHROME;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.fillStyle = HUD_COLOURS.ink;
    for (const [i, line] of panelLines(s, metric).entries()) {
      ctx.fillText(line, panel.textX, panel.baseline + i * panel.lineHeight);
    }

    // Glide meter. The label sits beside the bar rather than on top of it, so
    // the fill never covers it.
    const glide = HUD.glide;
    const fill = glideFill(s);
    ctx.fillStyle = HUD_COLOURS.ink;
    const label = 'glide';
    ctx.fillText(
      label,
      glide.x - ctx.measureText(label).width - glide.labelGap,
      glide.labelBaseline,
    );
    ctx.fillStyle = CHROME;
    ctx.fillRect(glide.x, glide.y, glide.w + 4, glide.h);
    ctx.fillStyle = hex(fill.colour);
    ctx.fillRect(glide.x + 2, glide.fillY, glide.w * fill.fraction, glide.fillH);

    if (this.#showHitboxes) {
      const debug = HUD.debug;
      ctx.fillStyle = CHROME;
      ctx.fillRect(debug.x, debug.y, debug.w, debug.h);
      ctx.fillStyle = HUD_COLOURS.debugInk;
      for (const [i, line] of debugLines(s).entries()) {
        ctx.fillText(line, debug.textX, debug.baseline + i * debug.lineHeight);
      }
    }

    const prompt = promptFor(s, metric);
    if (prompt !== null) {
      const box = HUD.prompt;
      ctx.font = FONTS.prompt;
      const width = ctx.measureText(prompt).width;
      ctx.fillStyle = PROMPT_CHROME;
      ctx.fillRect((C.VIEW_W - width) / 2 - box.pad, box.y, width + box.pad * 2, box.h);
      ctx.fillStyle = HUD_COLOURS.promptInk;
      ctx.fillText(prompt, (C.VIEW_W - width) / 2, box.baseline);
    }
  }
}

/**
 * The Canvas2D backend. Async only to satisfy `RendererFactory` - nothing here
 * needs to await, unlike Pixi's `Application.init()`.
 */
export function createCanvasRenderer(
  canvas: HTMLCanvasElement,
  assets: AssetBundle,
  effects: Effects,
  options: RendererOptions = {},
): Promise<Renderer> {
  return Promise.resolve(new GameRenderer(canvas, assets, effects, options));
}
