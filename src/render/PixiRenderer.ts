import {
  Application,
  CanvasTextMetrics,
  Container,
  Graphics,
  ImageSource,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  type TextureSource,
} from 'pixi.js';
import type { AssetBundle, Sprite as SpriteAsset } from '@/assets/AssetLoader.ts';
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

/** Kept identical to GameRenderer so the two are comparable. */
const SPRITE_FPS = 19;
const STAR_COUNT = 70;
const BUSH_SPACING = 260;

const MONO = 'ui-monospace, monospace';
const SANS = 'system-ui, sans-serif';

/**
 * PixiJS v8 backend, built to be measured against the Canvas2D one.
 *
 * It draws the same scene as `GameRenderer` - every layer, same `ox`/`oy`, same
 * alphas - because a backend that skips work is faster for uninteresting
 * reasons. Where the two genuinely differ is retained versus immediate mode:
 * the star field and the ground are static geometry built once here and
 * re-pathed every frame there. That is a real property of the architectures
 * rather than a trick, but it is also an optimisation Canvas2D could adopt with
 * an offscreen canvas, so read the star numbers with that in mind.
 *
 * Like the Canvas2D renderer it only ever sees a `SimSnapshot`.
 */
export class PixiRenderer implements Renderer {
  readonly #app: Application;
  readonly #canvas: HTMLCanvasElement;
  readonly #assets: AssetBundle;
  readonly #effects: Effects;
  readonly #stress: number;
  #showHitboxes: boolean;
  #elapsed = 0;
  #lastFrameTime = 0;
  #destroyed = false;

  /**
   * One GPU texture per atlas sheet, and one lightweight `Texture` view per
   * frame cut out of it. Because every sprite ends up on the same source, Pixi
   * batches the whole scene into a single draw call - which is the reason an
   * atlas is worth more to this backend than to the Canvas2D one.
   */
  readonly #sources = new Map<ImageBitmap, TextureSource>();
  readonly #textures = new Map<string, Texture>();

  // Layers.
  readonly #skyBottom: Sprite;
  readonly #skyTop: Sprite;
  readonly #stars: Graphics;
  readonly #world = new Container();
  readonly #bushes = new Container();
  readonly #markers = new Container();
  readonly #powerups = new Container();
  readonly #fxLayer = new Container();
  readonly #debugBoxes = new Graphics();
  readonly #pillow = new Sprite();
  readonly #shadowPivot = new Container();
  readonly #shadow = new Sprite();
  readonly #hamsterPivot = new Container();
  readonly #hamster = new Sprite();
  readonly #hud = new Container();

  // Pools and retained HUD pieces.
  readonly #bushPool: Sprite[] = [];
  readonly #powerupPool: Sprite[] = [];
  readonly #fxPool: Sprite[] = [];
  readonly #markerTicks: Sprite[] = [];
  readonly #markerLabels: Text[] = [];
  readonly #panelBg = solidRect();
  readonly #panelLines: [Text, Text];
  readonly #glideLabel: Text;
  readonly #glideBg = solidRect();
  readonly #glideFill = solidRect();
  readonly #debugBg = solidRect();
  readonly #debugLines: [Text, Text, Text];
  readonly #promptBg = solidRect();
  readonly #promptText: Text;

  /** Baselines, so Pixi's top-left text lands where fillText's baseline did. */
  readonly #ascentMono10: number;
  readonly #ascentMono12: number;
  readonly #ascentSans17: number;

  private constructor(
    app: Application,
    canvas: HTMLCanvasElement,
    assets: AssetBundle,
    effects: Effects,
    options: RendererOptions,
  ) {
    this.#app = app;
    this.#canvas = canvas;
    this.#assets = assets;
    this.#effects = effects;
    this.#showHitboxes = options.showHitboxes ?? false;
    this.#stress = Math.max(1, Math.floor(options.stress ?? 1));

    this.#ascentMono10 = CanvasTextMetrics.measureFont(`10px ${MONO}`).ascent;
    this.#ascentMono12 = CanvasTextMetrics.measureFont(`600 12px ${MONO}`).ascent;
    this.#ascentSans17 = CanvasTextMetrics.measureFont(`bold 17px ${SANS}`).ascent;

    this.#panelLines = [monoText(), monoText()];
    this.#glideLabel = monoText();
    this.#debugLines = [monoText('#9fe3ff'), monoText('#9fe3ff'), monoText('#9fe3ff')];
    this.#promptText = new Text({
      text: '',
      style: new TextStyle({ fontFamily: SANS, fontSize: 17, fontWeight: 'bold', fill: '#ffffff' }),
    });

    this.#skyBottom = solidRect();
    this.#skyTop = new Sprite(verticalFadeTexture());
    this.#stars = this.#bakeStars();

    this.#buildScene();
    this.resize();
  }

  /**
   * `Application.init()` is async in v8, so construction goes through here.
   * Note `autoStart: false`: FixedTimestepLoop stays the only clock in the app,
   * exactly as it is for the Canvas2D backend.
   */
  static async create(
    canvas: HTMLCanvasElement,
    assets: AssetBundle,
    effects: Effects,
    options: RendererOptions = {},
  ): Promise<PixiRenderer> {
    const app = new Application();
    await app.init({
      canvas,
      width: C.VIEW_W,
      height: C.VIEW_H,
      // Canvas2D antialiases its arcs and edges unconditionally, so matching
      // that is the fair setting even though it costs Pixi an MSAA buffer.
      antialias: true,
      // The Canvas2D renderer pins its backing store to VIEW_W/H * dpr and lets
      // CSS upscale. autoDensity: false reproduces that instead of resizing CSS.
      autoDensity: false,
      resolution: dpr(),
      backgroundAlpha: 1,
      // The sim never reads the pointer; input is bound to the canvas element.
      eventMode: 'none',
    });
    return new PixiRenderer(app, canvas, assets, effects, options);
  }

  // -- scene construction ----------------------------------------------------

  #buildScene(): void {
    const stage = this.#app.stage;

    const sky = new Container();
    for (const layer of [this.#skyBottom, this.#skyTop]) {
      layer.width = C.VIEW_W;
      layer.height = C.VIEW_H;
    }
    sky.addChild(this.#skyBottom, this.#skyTop, this.#stars);
    stage.addChild(sky);

    // Ground is two slabs the width of the whole course; static, so built once.
    const ground = new Container();
    ground.addChild(
      slab(-2000, C.GROUND_Y, 400000, 600, 0x5d9b47),
      slab(-2000, C.GROUND_Y, 400000, 5, 0x4b7f38),
    );

    this.#shadowPivot.addChild(this.#shadow);
    this.#hamsterPivot.addChild(this.#hamster);
    this.#world.addChild(
      ground,
      this.#bushes,
      this.#pillow,
      this.#markers,
      this.#powerups,
      this.#fxLayer,
      this.#shadowPivot,
      this.#hamsterPivot,
      this.#debugBoxes,
    );
    stage.addChild(this.#world);

    this.#hud.addChild(
      this.#panelBg,
      this.#panelLines[0],
      this.#panelLines[1],
      this.#glideLabel,
      this.#glideBg,
      this.#glideFill,
      this.#debugBg,
      this.#debugLines[0],
      this.#debugLines[1],
      this.#debugLines[2],
      this.#promptBg,
      this.#promptText,
    );
    stage.addChild(this.#hud);

    const pillow = this.#assets.get('pillow');
    if (pillow !== undefined) this.#pillow.texture = this.#texture(pillow, 0) ?? Texture.EMPTY;
    const shadow = this.#assets.get('shadow');
    if (shadow !== undefined) {
      this.#shadow.texture = this.#texture(shadow, 0) ?? Texture.EMPTY;
      this.#shadow.position.set(shadow.meta.ox, shadow.meta.oy);
      this.#shadow.alpha = 0.45;
    }

    // Static HUD chrome: positions and colours that never change.
    this.#panelBg.tint = 0x0c141e;
    this.#panelBg.alpha = 0.55;
    this.#panelBg.position.set(10, 10);
    this.#panelBg.width = 150;
    this.#panelBg.height = 16 * 2 + 10;
    this.#panelLines[0].position.set(18, 28 - this.#ascentMono12);
    this.#panelLines[1].position.set(18, 44 - this.#ascentMono12);

    this.#glideBg.tint = 0x0c141e;
    this.#glideBg.alpha = 0.55;
    this.#glideBg.position.set(GLIDE_X, 10);
    this.#glideBg.width = GLIDE_W + 4;
    this.#glideBg.height = 18;
    this.#glideFill.position.set(GLIDE_X + 2, 12);
    this.#glideFill.height = 14;
    this.#glideLabel.text = 'glide';
    this.#glideLabel.position.set(GLIDE_X - this.#glideLabel.width - 8, 24 - this.#ascentMono12);

    this.#debugBg.tint = 0x0c141e;
    this.#debugBg.alpha = 0.55;
    this.#debugBg.position.set(10, C.VIEW_H - 58);
    this.#debugBg.width = 260;
    this.#debugBg.height = 48;
    for (const [i, line] of this.#debugLines.entries()) {
      line.position.set(18, C.VIEW_H - 42 + i * 14 - this.#ascentMono12);
    }

    this.#promptBg.tint = 0x0c141e;
    this.#promptBg.alpha = 0.62;
    this.#promptBg.height = 32;
  }

  /**
   * The star field is a fixed hash, so it is geometry rather than per-frame
   * work. One Graphics keeps it to a single batch however many stars there are.
   */
  #bakeStars(): Graphics {
    const g = new Graphics();
    for (let i = 0; i < STAR_COUNT * this.#stress; i++) {
      const h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
      const x = (h % 1000) / 1000;
      const y = ((h >>> 10) % 1000) / 1000;
      const r = 0.6 + ((h >>> 20) % 3) * 0.35;
      g.circle(x * C.VIEW_W, y * C.VIEW_H, r);
    }
    g.fill(0xffffff);
    g.visible = false;
    return g;
  }

  // -- lifecycle -------------------------------------------------------------

  resize(): void {
    if (this.#destroyed) return;
    this.#app.renderer.resolution = dpr();
    this.#app.renderer.resize(C.VIEW_W, C.VIEW_H);
    // Pixi writes CSS size when it resizes; the stylesheet owns that here.
    this.#canvas.style.removeProperty('width');
    this.#canvas.style.removeProperty('height');
  }

  toggleHitboxes(): void {
    this.#showHitboxes = !this.#showHitboxes;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const texture of this.#textures.values()) texture.destroy();
    this.#textures.clear();
    for (const source of this.#sources.values()) source.destroy();
    this.#sources.clear();
    this.#app.destroy({ removeView: false }, { children: true });
  }

  // -- frame -----------------------------------------------------------------

  draw(s: SimSnapshot, now: number): void {
    if (this.#destroyed) return;
    if (this.#lastFrameTime !== 0) this.#elapsed += now - this.#lastFrameTime;
    this.#lastFrameTime = now;

    this.#sky(s);
    // Impact shake rides on the camera, so the HUD and the sky stay still.
    const shake = this.#effects.shakeOffset(now);
    this.#world.position.set(s.camera.x + shake.x, s.camera.y + shake.y);
    this.#ground(s);
    this.#drawPowerups(s);
    this.#drawFx(now);
    this.#drawHamster(s);
    this.#drawHud(s);
    if (this.#showHitboxes) this.#drawHitboxes(s);
    else this.#debugBoxes.clear();

    this.#app.renderer.render(this.#app.stage);
  }

  #sky(s: SimSnapshot): void {
    const altitude = clamp((C.GROUND_Y - s.hamster.y) / Math.abs(C.SPACE_BG_Y), 0, 1);
    // Two stops, so a static top-to-bottom alpha ramp tinted with the top
    // colour over a slab of the bottom colour reproduces the Canvas2D gradient
    // exactly - and without allocating a FillGradient every frame.
    this.#skyBottom.tint = mix([30, 40, 78], [176, 216, 240], 1 - altitude);
    this.#skyTop.tint = mix([12, 16, 40], [116, 182, 226], 1 - altitude);

    const visible = altitude > 0.35;
    this.#stars.visible = visible;
    if (visible) this.#stars.alpha = clamp((altitude - 0.35) / 0.4, 0, 1);
  }

  #ground(s: SimSnapshot): void {
    const spacing = BUSH_SPACING / this.#stress;
    const from = Math.floor((-s.camera.x - 200) / spacing) * spacing;
    const until = -s.camera.x + C.VIEW_W + 200;
    let used = 0;
    for (let x = from; x < until; x += spacing) {
      const h = Math.imul(x + 7919, 0x85ebca6b) >>> 0;
      const bush = this.#assets.get(`bush/${(h % 5) + 1}` as SpriteId);
      if (bush === undefined) continue;
      const sprite = this.#bushAt(used++);
      const texture = this.#texture(bush, 0);
      if (texture !== undefined) sprite.texture = texture;
      sprite.position.set(x + (h % 90) + bush.meta.ox, C.GROUND_Y + bush.meta.oy);
      sprite.visible = true;
    }
    hideFrom(this.#bushPool, used);

    const pillowSprite = this.#assets.get('pillow');
    if (pillowSprite !== undefined) {
      const x = s.phaseKind === 'ready' ? C.PILLOW_REST_X : C.PILLOW_LAUNCH_X;
      this.#pillow.position.set(x + pillowSprite.meta.ox, C.PILLOW_Y + pillowSprite.meta.oy);
      this.#pillow.visible = true;
    } else {
      this.#pillow.visible = false;
    }

    let ticks = 0;
    let labels = 0;
    const firstFoot = Math.max(0, Math.floor((-s.camera.x - 100) / C.PX_PER_FOOT / 10) * 10);
    for (let feet = firstFoot; feet * C.PX_PER_FOOT < until - 100; feet += 10) {
      const x = feet * C.PX_PER_FOOT;
      const tick = this.#tickAt(ticks++);
      tick.position.set(x, C.GROUND_Y - 7);
      tick.visible = true;
      if (feet % 50 === 0) {
        const label = this.#labelAt(labels++);
        setText(label, `${feet}ft`);
        label.position.set(x + 3, C.GROUND_Y - 10 - this.#ascentMono10);
        label.visible = true;
      }
    }
    hideFrom(this.#markerTicks, ticks);
    hideFrom(this.#markerLabels, labels);
  }

  #drawPowerups(s: SimSnapshot): void {
    let used = 0;
    for (const item of s.powerups) {
      const asset = this.#assets.get(POWERUP_SPRITE[item.kind]);
      if (asset === undefined) continue;
      const texture = this.#texture(asset, this.#animFrame(asset));
      if (texture === undefined) continue;
      for (let i = 0; i < this.#stress; i++) {
        const sprite = this.#powerupAt(used++);
        sprite.texture = texture;
        sprite.position.set(item.x + i * 3 + asset.meta.ox, item.y + i * 3 + asset.meta.oy);
        sprite.alpha = item.taken ? 0.25 : 1;
        sprite.visible = true;
      }
    }
    hideFrom(this.#powerupPool, used);
  }

  /** Impact clips, behind the hamster so it stays readable through them. */
  #drawFx(now: number): void {
    let used = 0;
    for (const fx of this.#effects.active(now)) {
      const asset = this.#assets.get(fx.sprite);
      if (asset === undefined) continue;
      const texture = this.#texture(asset, fx.frame);
      if (texture === undefined) continue;
      const sprite = poolAt(this.#fxPool, used++, this.#fxLayer, () => new Sprite());
      sprite.texture = texture;
      sprite.position.set(fx.x + asset.meta.ox, fx.y + asset.meta.oy);
      sprite.visible = true;
    }
    hideFrom(this.#fxPool, used);
  }

  #drawHamster(s: SimSnapshot): void {
    const h = s.hamster;
    if (!h.visible && s.phaseKind !== 'settling') {
      this.#hamsterPivot.visible = false;
      this.#shadowPivot.visible = false;
      return;
    }

    // Same clamp as the Canvas2D path: above y = 700 the original's factor goes
    // negative, which Flash renders as a flip - invisible on a symmetric ellipse.
    const scale = Math.max(0, (h.y - C.SHADOW_REF_Y) / C.SHADOW_DIV);
    const showShadow = this.#shadow.texture !== Texture.EMPTY && scale > 0.02;
    this.#shadowPivot.visible = showShadow;
    if (showShadow) {
      this.#shadowPivot.position.set(h.x, C.SHADOW_Y);
      this.#shadowPivot.scale.set(scale);
    }

    const asset = this.#assets.get(this.#poseFor(s));
    const texture = asset === undefined ? undefined : this.#texture(asset, this.#animFrame(asset));
    if (asset === undefined || texture === undefined) {
      this.#hamsterPivot.visible = false;
      return;
    }

    this.#hamsterPivot.visible = true;
    this.#hamsterPivot.position.set(h.x, h.y);
    // The original's `+ 90` is dropped because the exported poses face right;
    // see reference/doc/porting-notes.md.
    this.#hamsterPivot.rotation =
      s.phaseKind === 'flying' && h.doRotation ? Math.atan2(h.yvel, h.xvel) : 0;
    this.#hamster.texture = texture;
    this.#hamster.position.set(asset.meta.ox, asset.meta.oy);
  }

  #drawHitboxes(s: SimSnapshot): void {
    const g = this.#debugBoxes;
    g.clear();
    for (const item of s.powerups) {
      const box = DEFAULT_TUNING.boxes.powerups[item.kind];
      g.rect(item.x + box.cx - box.hw, item.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
    }
    g.stroke({ color: 0xff4d6d, width: 1 });

    const h = s.hamster;
    const box =
      s.phaseKind === 'flying'
        ? DEFAULT_TUNING.boxes.hamsterFlightCore
        : DEFAULT_TUNING.boxes.hamsterJumpCore;
    g.rect(h.x + box.cx - box.hw, h.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
    g.stroke({ color: 0x4dd2ff, width: 1 });
  }

  #drawHud(s: SimSnapshot): void {
    const shots = s.shots.reduce((a, b) => a + b, 0);
    setText(this.#panelLines[0], `try ${Math.min(s.turn, C.TURNS)}/${C.TURNS}`);
    setText(this.#panelLines[1], `${s.feet} ft   total ${shots} ft`);

    this.#glideFill.tint = s.glidePoints > 0 ? 0xffd166 : 0xff6b6b;
    this.#glideFill.width = Math.max(0, GLIDE_W * (s.glidePoints / C.GLIDE_MAX));

    const debug = this.#showHitboxes;
    this.#debugBg.visible = debug;
    for (const line of this.#debugLines) line.visible = debug;
    if (debug) {
      const h = s.hamster;
      setText(this.#debugLines[0], `x ${h.x.toFixed(1)}  y ${h.y.toFixed(1)}`);
      setText(this.#debugLines[1], `xvel ${h.xvel.toFixed(2)}  yvel ${h.yvel.toFixed(2)}`);
      const active = Object.entries(s.flags)
        .filter(([, on]) => on)
        .map(([name]) => name);
      setText(this.#debugLines[2], `t${s.tick} ${s.phaseKind} ${active.join(' ')}`);
    }

    const prompt = this.#prompt(s);
    const show = prompt !== null;
    this.#promptBg.visible = show;
    this.#promptText.visible = show;
    if (show) {
      setText(this.#promptText, prompt);
      const width = this.#promptText.width;
      this.#promptBg.position.set((C.VIEW_W - width) / 2 - 14, C.VIEW_H - 64);
      this.#promptBg.width = width + 28;
      this.#promptText.position.set((C.VIEW_W - width) / 2, C.VIEW_H - 42 - this.#ascentSans17);
    }
  }

  // -- shared logic, kept in step with GameRenderer ---------------------------

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

  #animFrame(sprite: SpriteAsset): number {
    const fps = sprite.meta.fps ?? SPRITE_FPS;
    if (sprite.meta.frames <= 1) return 0;
    return Math.floor((this.#elapsed / 1000) * fps) % sprite.meta.frames;
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

  // -- texture cache and pools -----------------------------------------------

  /**
   * Frames are views onto the atlas the shared loader already decoded, so both
   * backends consume the identical bitmaps - otherwise this would measure the
   * asset pipeline rather than the renderer.
   */
  #texture(sprite: SpriteAsset, frame: number): Texture | undefined {
    const rect = sprite.frames[frame] ?? sprite.frames[0];
    if (rect === undefined) return undefined;
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
    let texture = this.#textures.get(key);
    if (texture === undefined) {
      let source = this.#sources.get(sprite.sheet);
      if (source === undefined) {
        source = new ImageSource({ resource: sprite.sheet });
        this.#sources.set(sprite.sheet, source);
      }
      texture = new Texture({ source, frame: new Rectangle(rect.x, rect.y, rect.w, rect.h) });
      this.#textures.set(key, texture);
    }
    return texture;
  }

  #bushAt(index: number): Sprite {
    return poolAt(this.#bushPool, index, this.#bushes, () => new Sprite());
  }

  #powerupAt(index: number): Sprite {
    return poolAt(this.#powerupPool, index, this.#powerups, () => new Sprite());
  }

  #tickAt(index: number): Sprite {
    return poolAt(this.#markerTicks, index, this.#markers, () => {
      const tick = solidRect();
      tick.tint = 0xffffff;
      tick.alpha = 0.5;
      tick.width = 1;
      tick.height = 7;
      return tick;
    });
  }

  #labelAt(index: number): Text {
    return poolAt(this.#markerLabels, index, this.#markers, () => {
      const label = new Text({
        text: '',
        style: new TextStyle({ fontFamily: MONO, fontSize: 10, fill: '#ffffff' }),
      });
      label.alpha = 0.5;
      return label;
    });
  }
}

// -- module helpers ----------------------------------------------------------

const GLIDE_W = 110;
const GLIDE_X = C.VIEW_W - GLIDE_W - 14;

export function createPixiRenderer(
  canvas: HTMLCanvasElement,
  assets: AssetBundle,
  effects: Effects,
  options: RendererOptions = {},
): Promise<Renderer> {
  return PixiRenderer.create(canvas, assets, effects, options);
}

function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/** A 1x1 white sprite; set width/height/tint and it is a filled rectangle. */
function solidRect(): Sprite {
  return new Sprite(Texture.WHITE);
}

function slab(x: number, y: number, w: number, h: number, tint: number): Sprite {
  const sprite = solidRect();
  sprite.position.set(x, y);
  sprite.width = w;
  sprite.height = h;
  sprite.tint = tint;
  return sprite;
}

/** Opaque at the top, transparent at the bottom. Built once, tinted per frame. */
function verticalFadeTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return Texture.WHITE;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, 256);
  return Texture.from(canvas);
}

function monoText(fill = '#eaf6ff'): Text {
  return new Text({
    text: '',
    style: new TextStyle({ fontFamily: MONO, fontSize: 12, fontWeight: '600', fill }),
  });
}

/** Uploading a text texture is expensive; only do it when the string moved. */
function setText(target: Text, value: string): void {
  if (target.text !== value) target.text = value;
}

function poolAt<T extends Container>(
  pool: T[],
  index: number,
  parent: Container,
  make: () => T,
): T {
  let item = pool[index];
  if (item === undefined) {
    item = make();
    pool[index] = item;
    parent.addChild(item);
  }
  return item;
}

function hideFrom(pool: readonly Container[], from: number): void {
  for (let i = from; i < pool.length; i++) {
    const item = pool[i];
    if (item !== undefined) item.visible = false;
  }
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Same interpolation as the Canvas2D renderer, packed for Pixi's tint. */
function mix(a: readonly number[], b: readonly number[], t: number): number {
  const channel = (i: number): number => Math.round((a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t);
  return (channel(0) << 16) | (channel(1) << 8) | channel(2);
}
