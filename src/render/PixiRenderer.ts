import {
  Application,
  CanvasTextMetrics,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  type Texture,
} from 'pixi.js';
import type { AssetBundle } from '@/assets/AssetLoader.ts';
import type { Effects } from '@/render/effects/Effects.ts';
import type { PreLaunchLayout } from '@/render/PreLaunchScene.ts';
import {
  hideFrom,
  place,
  poolAt,
  slab,
  solidRect,
  verticalFadeTexture,
} from '@/render/pixi/helpers.ts';
import { PixiHud } from '@/render/pixi/PixiHud.ts';
import { SceneFilters } from '@/render/pixi/SceneFilters.ts';
import { TextureCache } from '@/render/pixi/TextureCache.ts';
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
  rgbInt,
  SHADOW_ALPHA,
  SHADOW_MIN_SCALE,
  shadowScale,
  skyColours,
  starField,
} from '@/render/scene/decor.ts';
import { FONTS, HUD_COLOURS } from '@/render/scene/hud.ts';
import { bottomCrop, hamsterRotation, outcomeOffsetY, poseFor } from '@/render/scene/pose.ts';
import { C } from '@/sim/constants.ts';
import type { SimSnapshot } from '@/sim/state.ts';
import { DEFAULT_TUNING, type Tuning } from '@/sim/tuning.ts';

/**
 * PixiJS v8 backend, built to be measured against the Canvas2D one.
 *
 * It draws the same scene as `GameRenderer` - every layer, same `ox`/`oy`, same
 * alphas - because a backend that skips work is faster for uninteresting
 * reasons. That is not a matter of discipline any more: what to draw comes
 * from `src/render/scene`, the same functions the Canvas2D backend calls.
 * Where the two genuinely differ is retained versus immediate mode: the star
 * field and the ground are static geometry built once here and re-pathed
 * every frame there. That is a real property of the architectures rather than
 * a trick, but it is also an optimisation Canvas2D could adopt with an
 * offscreen canvas, so read the star numbers with that in mind.
 *
 * Like the Canvas2D renderer it only ever sees a `SimSnapshot`.
 */
export class PixiRenderer implements Renderer {
  readonly #app: Application;
  readonly #canvas: HTMLCanvasElement;
  readonly #assets: AssetBundle;
  readonly #effects: Effects;
  readonly #tuning: Tuning;
  readonly #stress: number;
  #showHitboxes: boolean;
  #elapsed = 0;
  #lastFrameTime = 0;
  #destroyed = false;

  readonly #textures = new TextureCache();
  readonly #filters = new SceneFilters();
  readonly #hud: PixiHud;

  // Layers.
  readonly #skyBottom = solidRect();
  readonly #skyTop: Sprite;
  readonly #skyFade: Texture | null;
  readonly #stars: Graphics;
  /** Sky plus world. Filters hang here so the HUD is never blurred or tinted. */
  readonly #scene = new Container();
  readonly #world = new Container();
  readonly #bushes = new Container();
  readonly #markers = new Container();
  readonly #powerups = new Container();
  readonly #fxLayer = new Container();
  readonly #particleLayer = new Container();
  /** Follows the world but sits outside the filtered scene, like the Canvas2D overlay. */
  readonly #overlay = new Container();
  readonly #debugBoxes = new Graphics();
  /** The launcher and the queue, over the bushes and under the markers. */
  readonly #launcher = new Container();
  readonly #shadowPivot = new Container();
  readonly #shadow = new Sprite();
  readonly #hamsterPivot = new Container();
  /** Drawn under the bubble in enhanced mode, so the hamster stays visible. */
  readonly #hamsterInner = new Sprite();
  readonly #hamster = new Sprite();

  // Pools.
  readonly #bushPool: Sprite[] = [];
  readonly #powerupPool: Sprite[] = [];
  readonly #fxPool: Sprite[] = [];
  readonly #particlePool: Sprite[] = [];
  readonly #markerTicks: Sprite[] = [];
  readonly #markerLabels: Text[] = [];
  readonly #launcherPool: Sprite[] = [];
  readonly #ascentMono10: number;

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
    this.#tuning = options.tuning ?? DEFAULT_TUNING;
    this.#showHitboxes = options.showHitboxes ?? false;
    this.#stress = Math.max(1, Math.floor(options.stress ?? 1));
    this.#hud = new PixiHud(assets, this.#textures);
    this.#ascentMono10 = CanvasTextMetrics.measureFont(FONTS.marker).ascent;

    this.#skyFade = verticalFadeTexture();
    this.#skyTop = this.#skyFade === null ? solidRect() : new Sprite(this.#skyFade);
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
      resolution: dpr(canvas),
      backgroundAlpha: 1,
      // The sim never reads the pointer; input is bound to the canvas element.
      eventMode: 'none',
      // `SceneFilter` ships a GLSL program only. Auto-detection tries WebGL
      // first anyway, but a machine where WebGL fails and WebGPU succeeds
      // would boot and then throw on the first impact; pin it so it fails
      // over to Canvas2D at start-up instead, where main.ts catches it.
      preference: 'webgl',
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
    this.#scene.addChild(sky);
    // The filters centre their effects on screen fractions and the ground slab
    // always covers the view, so the scene's filter area is the viewport. Said
    // explicitly, it stops depending on the ground geometry and saves Pixi a
    // bounds walk on every filtered frame.
    this.#scene.filterArea = new Rectangle(0, 0, C.VIEW_W, C.VIEW_H);
    stage.addChild(this.#scene);

    // Ground is two slabs the width of the whole course; static, so built once.
    const ground = new Container();
    ground.addChild(
      slab(GROUND.x, C.GROUND_Y, GROUND.width, GROUND.height, GROUND.colour),
      slab(GROUND.x, C.GROUND_Y, GROUND.width, GROUND.lip, GROUND.lipColour),
    );

    this.#shadowPivot.addChild(this.#shadow);
    this.#hamsterPivot.addChild(this.#hamsterInner, this.#hamster);
    this.#world.addChild(
      ground,
      this.#bushes,
      this.#launcher,
      this.#markers,
      this.#powerups,
      this.#fxLayer,
      this.#particleLayer,
      this.#shadowPivot,
      this.#hamsterPivot,
    );
    this.#scene.addChild(this.#world);
    this.#overlay.addChild(this.#debugBoxes);
    stage.addChild(this.#overlay);
    stage.addChild(this.#hud.container);

    const shadow = this.#assets.get('shadow');
    if (shadow !== undefined) {
      const texture = this.#textures.get(shadow, 0);
      if (texture !== undefined) this.#shadow.texture = texture;
      place(this.#shadow, shadow, 0, 0);
      this.#shadow.alpha = SHADOW_ALPHA;
    }
  }

  /**
   * The star field is a fixed hash, so it is geometry rather than per-frame
   * work. One Graphics keeps it to a single batch however many stars there are.
   */
  #bakeStars(): Graphics {
    const g = new Graphics();
    for (const star of starField(this.#stress)) g.circle(star.x, star.y, star.r);
    g.fill(0xffffff);
    g.visible = false;
    return g;
  }

  // -- lifecycle -------------------------------------------------------------

  resize(): void {
    if (this.#destroyed) return;
    // One call: setting `resolution` separately re-sized the render target
    // twice. `autoDensity` is off, so Pixi never touches the CSS size here.
    this.#app.renderer.resize(C.VIEW_W, C.VIEW_H, dpr(this.#canvas));
  }

  resync(): void {
    this.#lastFrameTime = 0;
  }

  toggleHitboxes(): void {
    this.#showHitboxes = !this.#showHitboxes;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#filters.destroy(this.#scene);
    this.#textures.destroy();
    this.#skyFade?.destroy(true);
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
    const offsetX = s.camera.x + shake.x;
    const offsetY = s.camera.y + shake.y;
    this.#world.position.set(offsetX, offsetY);
    this.#overlay.position.set(offsetX, offsetY);
    const scene = this.#effects.scene.layout(s, now);
    this.#ground(s);
    this.#drawScene(scene);
    this.#drawPowerups(s);
    this.#drawFx(now);
    this.#drawParticles(now);
    this.#drawHamster(s);
    this.#hud.draw(s, scene, this.#effects.enhanced, this.#showHitboxes);
    this.#filters.apply(this.#scene, s, this.#effects, now, offsetX, offsetY);
    if (this.#showHitboxes) this.#drawHitboxes(s);
    else this.#debugBoxes.clear();

    this.#app.renderer.render(this.#app.stage);
  }

  #sky(s: SimSnapshot): void {
    const sky = skyColours(altitudeOf(s));
    // Two stops, so a static top-to-bottom alpha ramp tinted with the top
    // colour over a slab of the bottom colour reproduces the Canvas2D gradient
    // exactly - and without allocating a FillGradient every frame.
    this.#skyBottom.tint = rgbInt(sky.bottom);
    this.#skyTop.tint = rgbInt(sky.top);
    this.#stars.visible = sky.starAlpha > 0;
    if (sky.starAlpha > 0) this.#stars.alpha = sky.starAlpha;
  }

  #ground(s: SimSnapshot): void {
    let used = 0;
    for (const bush of bushes(s.camera.x, this.#stress)) {
      const asset = this.#assets.get(bush.sprite);
      if (asset === undefined) continue;
      const sprite = poolAt(this.#bushPool, used++, this.#bushes, () => new Sprite());
      const texture = this.#textures.get(asset, 0);
      if (texture !== undefined) sprite.texture = texture;
      place(sprite, asset, bush.x, bush.y);
      sprite.visible = true;
    }
    hideFrom(this.#bushPool, used);

    const marks = markers(s.camera.x, this.#effects.enhanced);
    for (const [i, x] of marks.ticks.entries()) {
      const tick = this.#tickAt(i);
      tick.position.set(x, C.GROUND_Y - 7);
      tick.visible = true;
    }
    hideFrom(this.#markerTicks, marks.ticks.length);
    for (const [i, label] of marks.labels.entries()) {
      const text = this.#labelAt(i);
      if (text.text !== label.text) text.text = label.text;
      text.position.set(label.x + 3, C.GROUND_Y - 10 - this.#ascentMono10);
      text.visible = true;
    }
    hideFrom(this.#markerLabels, marks.labels.length);
  }

  #drawPowerups(s: SimSnapshot): void {
    let used = 0;
    for (const item of s.powerups) {
      const asset = this.#assets.get(POWERUP_SPRITE[item.kind]);
      if (asset === undefined) continue;
      const texture = this.#textures.get(asset, POWERUP_IDLE_FRAME);
      if (texture === undefined) continue;
      for (let i = 0; i < this.#stress; i++) {
        const sprite = poolAt(this.#powerupPool, used++, this.#powerups, () => new Sprite());
        sprite.texture = texture;
        place(sprite, asset, item.x + i * 3, item.y + i * 3);
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
      const texture = this.#textures.get(asset, fx.frame);
      if (texture === undefined) continue;
      const sprite = poolAt(this.#fxPool, used++, this.#fxLayer, () => new Sprite());
      sprite.texture = texture;
      place(sprite, asset, fx.x, fx.y);
      sprite.visible = true;
    }
    hideFrom(this.#fxPool, used);
  }

  /**
   * Skid grit and pickup sparks. Every particle is the same 1x1 white texture
   * with a tint, so the whole system collapses into one extra draw call rather
   * than one per particle.
   */
  #drawParticles(now: number): void {
    let used = 0;
    for (const p of this.#effects.particles(now)) {
      const sprite = poolAt(this.#particlePool, used++, this.#particleLayer, solidRect);
      sprite.position.set(p.x - p.size / 2, p.y - p.size / 2);
      sprite.width = p.size;
      sprite.height = p.size;
      sprite.tint = p.tint;
      sprite.alpha = 1 - p.age;
      sprite.visible = true;
    }
    hideFrom(this.#particlePool, used);
  }

  #drawHamster(s: SimSnapshot): void {
    const h = s.hamster;
    if (!h.visible && s.phaseKind !== 'settling') {
      this.#hamsterPivot.visible = false;
      this.#shadowPivot.visible = false;
      return;
    }

    // `blt.shadClip._visible = false` on every arm that ends a shot -
    // Game.as:870, 876, 969 - so the outcome clip casts none.
    const scale = s.phaseKind === 'settling' ? 0 : shadowScale(h.y);
    const showShadow = this.#assets.get('shadow') !== undefined && scale > SHADOW_MIN_SCALE;
    this.#shadowPivot.visible = showShadow;
    if (showShadow) {
      this.#shadowPivot.position.set(h.x, C.SHADOW_Y);
      this.#shadowPivot.scale.set(scale);
    }

    const pose = poseFor(s);
    const asset = this.#assets.get(pose);
    const texture =
      asset === undefined
        ? undefined
        : this.#textures.get(
            asset,
            this.#effects.poses.frame(s, asset.meta, this.#elapsed),
            bottomCrop(s),
          );
    if (asset === undefined || texture === undefined) {
      this.#hamsterPivot.visible = false;
      return;
    }

    // The bubble is opaque in the original, so the hamster vanishes inside it
    // for the whole bounce. Enhanced mode draws the flier underneath.
    const inBubble = pose === 'hamster/ball' && this.#effects.enhanced;
    this.#hamsterInner.visible = inBubble;
    this.#hamster.alpha = inBubble ? BUBBLE_ALPHA : 1;
    if (inBubble) {
      const inside = this.#assets.get('hamster/fly');
      const insideTexture =
        inside === undefined
          ? undefined
          : this.#textures.get(inside, this.#effects.poses.innerFrame(inside.meta, this.#elapsed));
      if (inside !== undefined && insideTexture !== undefined) {
        this.#hamsterInner.texture = insideTexture;
        place(this.#hamsterInner, inside, 0, 0);
      } else {
        this.#hamsterInner.visible = false;
      }
    }

    this.#hamsterPivot.visible = true;
    this.#hamsterPivot.position.set(h.x, h.y + outcomeOffsetY(s));
    this.#hamsterPivot.rotation = hamsterRotation(s);
    this.#hamster.texture = texture;
    place(this.#hamster, asset, 0, 0);
  }

  #drawHitboxes(s: SimSnapshot): void {
    const g = this.#debugBoxes;
    g.clear();
    for (const item of s.powerups) {
      const box = this.#tuning.boxes.powerups[item.kind];
      g.rect(item.x + box.cx - box.hw, item.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
    }
    g.stroke({ color: HUD_COLOURS.hitboxPowerup, width: 1 });

    const h = s.hamster;
    const box =
      s.phaseKind === 'flying'
        ? this.#tuning.boxes.hamsterFlightCore
        : this.#tuning.boxes.hamsterJumpCore;
    g.rect(h.x + box.cx - box.hw, h.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
    g.stroke({ color: HUD_COLOURS.hitboxHamster, width: 1 });
  }

  /**
   * The launcher and the queue, straight out of the shared layout. Both
   * backends read the same list in the same order, so they cannot drift.
   */
  #drawScene(scene: PreLaunchLayout): void {
    let used = 0;
    for (const at of scene.world) {
      const asset = this.#assets.get(at.sprite);
      if (asset === undefined) continue;
      const sprite = poolAt(this.#launcherPool, used++, this.#launcher, () => new Sprite());
      const texture = this.#textures.get(asset, at.frame);
      if (texture !== undefined) sprite.texture = texture;
      place(sprite, asset, at.x, at.y);
      sprite.visible = true;
    }
    hideFrom(this.#launcherPool, used);
  }

  // -- pools -------------------------------------------------------------------

  #tickAt(index: number): Sprite {
    return poolAt(this.#markerTicks, index, this.#markers, () => {
      const tick = solidRect();
      tick.tint = 0xffffff;
      tick.alpha = HUD_COLOURS.markerAlpha;
      tick.width = 1;
      tick.height = 7;
      return tick;
    });
  }

  #labelAt(index: number): Text {
    return poolAt(this.#markerLabels, index, this.#markers, () => {
      const label = new Text({
        text: '',
        style: new TextStyle({ fontFamily: FONTS.mono, fontSize: 10, fill: HUD_COLOURS.markerInk }),
      });
      label.alpha = HUD_COLOURS.markerAlpha;
      return label;
    });
  }
}

export function createPixiRenderer(
  canvas: HTMLCanvasElement,
  assets: AssetBundle,
  effects: Effects,
  options: RendererOptions = {},
): Promise<Renderer> {
  return PixiRenderer.create(canvas, assets, effects, options);
}

function dpr(canvas: HTMLCanvasElement): number {
  return stageScale(canvas.getBoundingClientRect().width, window.devicePixelRatio);
}
