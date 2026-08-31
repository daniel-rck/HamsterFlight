import type { AssetBundle, Sprite } from '@/assets/AssetLoader.ts';
import type { SpriteId } from '@/assets/sprites.generated.ts';
import type { Effects } from '@/render/effects/Effects.ts';
import type { Renderer, RendererOptions } from '@/render/Renderer.ts';
import { C } from '@/sim/constants.ts';
import type { SimSnapshot } from '@/sim/state.ts';
import { DEFAULT_TUNING } from '@/sim/tuning.ts';
import type { PowerupKind } from '@/sim/types.ts';

const POWERUP_SPRITE: Record<PowerupKind, SpriteId> = {
  bounce: 'powerup/bounce',
  speed: 'powerup/speed',
  wind: 'powerup/wind',
  slide: 'powerup/slide',
  rebound: 'powerup/rebound',
  superbounce: 'powerup/superbounce',
};

/** Sprite frames advance on real time at the original stage rate. */
const SPRITE_FPS = 19;

/** Decoration counts at stress 1. Both renderers use these, so they compare. */
const STAR_COUNT = 70;
const BUSH_SPACING = 260;

/**
 * Canvas 2D renderer for the 600x400 stage.
 *
 * It reads a `SimSnapshot` and nothing else, so it cannot influence physics.
 * Sprite placement comes entirely from the generated manifest's `ox`/`oy`,
 * which are the offsets Flash itself used - there are no per-sprite magic
 * numbers in here.
 */
export class GameRenderer implements Renderer {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #canvas: HTMLCanvasElement;
  readonly #assets: AssetBundle;
  readonly #effects: Effects;
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
    this.#showHitboxes = options.showHitboxes ?? false;
    this.#stress = Math.max(1, Math.floor(options.stress ?? 1));
    this.resize();
  }

  resize(): void {
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#canvas.width = Math.round(C.VIEW_W * this.#dpr);
    this.#canvas.height = Math.round(C.VIEW_H * this.#dpr);
    this.#ctx.imageSmoothingQuality = 'high';
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
    // offsets, so they apply directly as a translation.
    ctx.setTransform(d, 0, 0, d, s.camera.x * d, s.camera.y * d);
    this.#ground(ctx, s);
    this.#powerups(ctx, s);
    this.#fx(ctx, now);
    this.#hamster(ctx, s);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.#hud(ctx, s);
  }

  // -- layers ---------------------------------------------------------------

  #sky(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    // The higher the hamster, the darker the sky - space is reachable.
    const altitude = clamp((C.GROUND_Y - s.hamster.y) / Math.abs(C.SPACE_BG_Y), 0, 1);
    const gradient = ctx.createLinearGradient(0, 0, 0, C.VIEW_H);
    gradient.addColorStop(0, mix([12, 16, 40], [116, 182, 226], 1 - altitude));
    gradient.addColorStop(1, mix([30, 40, 78], [176, 216, 240], 1 - altitude));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);

    if (altitude > 0.35) this.#stars(ctx, altitude);
  }

  #stars(ctx: CanvasRenderingContext2D, altitude: number): void {
    ctx.globalAlpha = clamp((altitude - 0.35) / 0.4, 0, 1);
    ctx.fillStyle = '#fff';
    // Deterministic from a cheap hash, so the field is stable without state.
    for (let i = 0; i < STAR_COUNT * this.#stress; i++) {
      const h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
      const x = (h % 1000) / 1000;
      const y = ((h >>> 10) % 1000) / 1000;
      const r = 0.6 + ((h >>> 20) % 3) * 0.35;
      ctx.beginPath();
      ctx.arc(x * C.VIEW_W, y * C.VIEW_H, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  #ground(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    ctx.fillStyle = '#5d9b47';
    ctx.fillRect(-2000, C.GROUND_Y, 400000, 600);
    ctx.fillStyle = '#4b7f38';
    ctx.fillRect(-2000, C.GROUND_Y, 400000, 5);

    // Bushes, drawn from a stable hash of their position so no state is needed.
    const spacing = BUSH_SPACING / this.#stress;
    const from = Math.floor((-s.camera.x - 200) / spacing) * spacing;
    for (let x = from; x < -s.camera.x + C.VIEW_W + 200; x += spacing) {
      const h = Math.imul(x + 7919, 0x85ebca6b) >>> 0;
      const bush = this.#assets.get(`bush/${(h % 5) + 1}` as SpriteId);
      if (bush !== undefined) this.#blit(ctx, bush, 0, x + (h % 90), C.GROUND_Y);
    }

    const pillow = this.#assets.get('pillow');
    if (pillow !== undefined) {
      const x = s.phaseKind === 'ready' ? C.PILLOW_REST_X : C.PILLOW_LAUNCH_X;
      this.#blit(ctx, pillow, 0, x, C.PILLOW_Y);
    }

    // Distance markers, so progress is readable without the HUD.
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '10px ui-monospace, monospace';
    const firstFoot = Math.max(0, Math.floor((-s.camera.x - 100) / C.PX_PER_FOOT / 10) * 10);
    for (let feet = firstFoot; feet * C.PX_PER_FOOT < -s.camera.x + C.VIEW_W + 100; feet += 10) {
      const x = feet * C.PX_PER_FOOT;
      ctx.fillRect(x, C.GROUND_Y - 7, 1, 7);
      if (feet % 50 === 0) ctx.fillText(`${feet}ft`, x + 3, C.GROUND_Y - 10);
    }
  }

  /** Impact clips, behind the hamster so it stays readable through them. */
  #fx(ctx: CanvasRenderingContext2D, now: number): void {
    for (const fx of this.#effects.active(now)) {
      const sprite = this.#assets.get(fx.sprite);
      if (sprite !== undefined) this.#blit(ctx, sprite, fx.frame, fx.x, fx.y);
    }
  }

  #powerups(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    for (const item of s.powerups) {
      const sprite = this.#assets.get(POWERUP_SPRITE[item.kind]);
      if (sprite === undefined) continue;
      ctx.globalAlpha = item.taken ? 0.25 : 1;
      const frame = this.#animFrame(sprite);
      for (let i = 0; i < this.#stress; i++) {
        this.#blit(ctx, sprite, frame, item.x + i * 3, item.y + i * 3);
      }
      ctx.globalAlpha = 1;

      if (this.#showHitboxes) {
        const box = DEFAULT_TUNING.boxes.powerups[item.kind];
        ctx.strokeStyle = '#ff4d6d';
        ctx.lineWidth = 1;
        ctx.strokeRect(item.x + box.cx - box.hw, item.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
      }
    }
  }

  #hamster(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    const h = s.hamster;
    if (!h.visible && s.phaseKind !== 'settling') return;

    // The shadow scales linearly with height: 100 * (y - 700) / 263. Above
    // y = 700 the factor goes negative, which Flash renders as a flip - for a
    // symmetric ellipse that is invisible, so it is clamped to zero here.
    const shadow = this.#assets.get('shadow');
    const scale = Math.max(0, (h.y - C.SHADOW_REF_Y) / C.SHADOW_DIV);
    if (shadow !== undefined && scale > 0.02) {
      ctx.save();
      ctx.translate(h.x, C.SHADOW_Y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 0.45;
      this.#blit(ctx, shadow, 0, 0, 0);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    const id = this.#poseFor(s);
    const sprite = this.#assets.get(id);
    if (sprite === undefined) return;

    const flying = s.phaseKind === 'flying';
    ctx.save();
    ctx.translate(h.x, h.y);
    if (flying && h.doRotation) {
      // The original writes `_rotation = radToDeg(atan2(yvel, xvel)) + 90`
      // because its art is authored pointing up. The exported poses face
      // right, so the +90 is dropped and the sprite aligns with velocity.
      ctx.rotate(Math.atan2(h.yvel, h.xvel));
    }
    this.#blit(ctx, sprite, this.#animFrame(sprite), 0, 0);
    ctx.restore();

    if (this.#showHitboxes) {
      const box = flying
        ? DEFAULT_TUNING.boxes.hamsterFlightCore
        : DEFAULT_TUNING.boxes.hamsterJumpCore;
      ctx.strokeStyle = '#4dd2ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(h.x + box.cx - box.hw, h.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
    }
  }

  /** Which pose the original would have made visible for this state. */
  #poseFor(s: SimSnapshot): SpriteId {
    if (s.phaseKind === 'jumping' || s.phaseKind === 'ready') return 'hamster/jump';
    if (s.phaseKind === 'settling') {
      switch (s.outcome) {
        case 'hole':
          return 'hit/hole';
        case 'cheer':
          return 'hit/cheer';
        case 'zero':
          return 'hit/zero';
        default:
          return 'hit/faceplant';
      }
    }
    const f = s.flags;
    if (f.slide && f.skidding) return 'hamster/slide';
    if (f.skidding) return 'hamster/skid';
    if (f.bounce || f.superbounce) return 'hamster/ball';
    if (f.falling) return 'hamster/drop';
    if (f.glide) return 'hamster/glide';
    if (f.speed) return 'hamster/blur';
    if (f.wind) return 'hamster/wind';
    return 'hamster/fly';
  }

  #animFrame(sprite: Sprite): number {
    const fps = sprite.meta.fps ?? SPRITE_FPS;
    if (sprite.meta.frames <= 1) return 0;
    return Math.floor((this.#elapsed / 1000) * fps) % sprite.meta.frames;
  }

  /** Cuts one frame out of the atlas sheet and places it by the manifest offsets. */
  #blit(ctx: CanvasRenderingContext2D, sprite: Sprite, frame: number, x: number, y: number): void {
    const rect = sprite.frames[frame] ?? sprite.frames[0];
    if (rect === undefined) return;
    ctx.drawImage(
      sprite.sheet,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      x + sprite.meta.ox,
      y + sprite.meta.oy,
      rect.w,
      rect.h,
    );
  }

  // -- HUD ------------------------------------------------------------------

  #hud(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    ctx.font = '600 12px ui-monospace, monospace';

    const shots = s.shots.reduce((a, b) => a + b, 0);
    const panelLines = [
      `try ${Math.min(s.turn, C.TURNS)}/${C.TURNS}`,
      `${s.feet} ft   total ${shots} ft`,
    ];
    ctx.fillStyle = 'rgba(12,20,30,.55)';
    ctx.fillRect(10, 10, 150, 16 * panelLines.length + 10);
    ctx.fillStyle = '#eaf6ff';
    for (const [i, line] of panelLines.entries()) ctx.fillText(line, 18, 28 + i * 16);

    // Glide meter. The label sits beside the bar rather than on top of it, so
    // the fill never covers it.
    const w = 110;
    const barX = C.VIEW_W - w - 14;
    ctx.fillStyle = '#eaf6ff';
    const label = 'glide';
    ctx.fillText(label, barX - ctx.measureText(label).width - 8, 24);
    ctx.fillStyle = 'rgba(12,20,30,.55)';
    ctx.fillRect(barX, 10, w + 4, 18);
    ctx.fillStyle = s.glidePoints > 0 ? '#ffd166' : '#ff6b6b';
    ctx.fillRect(barX + 2, 12, w * (s.glidePoints / C.GLIDE_MAX), 14);

    if (this.#showHitboxes) {
      ctx.fillStyle = 'rgba(12,20,30,.55)';
      ctx.fillRect(10, C.VIEW_H - 58, 260, 48);
      ctx.fillStyle = '#9fe3ff';
      ctx.fillText(`x ${s.hamster.x.toFixed(1)}  y ${s.hamster.y.toFixed(1)}`, 18, C.VIEW_H - 42);
      ctx.fillText(
        `xvel ${s.hamster.xvel.toFixed(2)}  yvel ${s.hamster.yvel.toFixed(2)}`,
        18,
        C.VIEW_H - 28,
      );
      const active = Object.entries(s.flags)
        .filter(([, on]) => on)
        .map(([name]) => name);
      ctx.fillText(`t${s.tick} ${s.phaseKind} ${active.join(' ')}`, 18, C.VIEW_H - 14);
    }

    const prompt = this.#prompt(s);
    if (prompt !== null) {
      ctx.font = 'bold 17px system-ui, sans-serif';
      const width = ctx.measureText(prompt).width;
      ctx.fillStyle = 'rgba(12,20,30,.62)';
      ctx.fillRect((C.VIEW_W - width) / 2 - 14, C.VIEW_H - 64, width + 28, 32);
      ctx.fillStyle = '#fff';
      ctx.fillText(prompt, (C.VIEW_W - width) / 2, C.VIEW_H - 42);
    }
  }

  #prompt(s: SimSnapshot): string | null {
    if (s.paused) return 'paused - P to resume';
    switch (s.phaseKind) {
      case 'ready':
        return 'click to jump';
      case 'jumping':
        return 'click again to hit the pillow';
      case 'flying':
        return s.flags.skidding ? null : 'hold to glide';
      case 'gameOver':
        return `${s.shots.reduce((a, b) => a + b, 0)} ft total - click to play again`;
      default:
        return null;
    }
  }
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function mix(a: readonly number[], b: readonly number[], t: number): string {
  const channel = (i: number): number => Math.round((a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
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
