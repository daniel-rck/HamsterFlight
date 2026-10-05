import {
  Application,
  CanvasTextMetrics,
  Container,
  Graphics,
  GraphicsContext,
  Matrix,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";
import type { AssetBundle } from "@/assets/AssetLoader.ts";
import type { SpriteId } from "@/assets/sprites.generated.ts";
import type { Effects } from "@/render/effects/Effects.ts";
import {
  hideFrom,
  place,
  placeInParent,
  poolAt,
  slab,
  solidRect,
  verticalFadeTexture,
  vignetteTexture,
} from "@/render/pixi/helpers.ts";
import { PixiHud } from "@/render/pixi/PixiHud.ts";
import { SceneFilters } from "@/render/pixi/SceneFilters.ts";
import { TextureCache } from "@/render/pixi/TextureCache.ts";
import type { PreLaunchLayout } from "@/render/PreLaunchScene.ts";
import type { Renderer, RendererOptions } from "@/render/Renderer.ts";
import { elementScale } from "@/render/resolution.ts";
import {
  altitudeOf,
  BUBBLE_ALPHA,
  bushes,
  CLOUD_BASE_H,
  CLOUD_SHADE,
  CLOUD_SHADE_DROP,
  CLOUD_SHAPES,
  type CloudShape,
  cloudAlpha,
  cloudColours,
  clouds,
  GROUND,
  GROUND_SLABS,
  HILL_LAYERS,
  HILL_TILE,
  HORIZON_GLOW,
  type HillLayer,
  hillColour,
  hillProfile,
  hillVisible,
  horizonGlowAlpha,
  horizonGlowVisible,
  horizonY,
  markers,
  POWERUP_IDLE_FRAME,
  POWERUP_SPRITE,
  POWERUP_TAKEN_ALPHA,
  particleAlpha,
  rgbInt,
  SHADOW_ALPHA,
  STAR_LAYERS,
  skyColours,
  starField,
  starOffset,
  TUFT_COLOUR,
  tileOrigins,
  tuftBlades,
  tufts,
  worldTileOrigins,
  TUFT_TILE,
} from "@/render/scene/decor.ts";
import {
  BALL_BADGE,
  ballBadge,
  FONTS,
  HUD_COLOURS,
  HUD_TYPE,
  type HudStrings,
  launchZones,
} from "@/render/scene/hud.ts";
import {
  FLAG,
  type FlagKind,
  flagGeometry,
  GHOST_ALPHA,
  type GhostPose,
  labelOffsets,
  NO_OVERLAY,
  type Overlay,
  visibleFlags,
} from "@/render/scene/overlay.ts";
import {
  boxRect,
  hamsterBox,
  hamsterRotation,
  hamsterShadow,
  isBallPose,
  outcomeOffsetY,
  poseAlpha,
  poseFor,
} from "@/render/scene/pose.ts";
import { SIGN_TEXT, signFields, signScaleX, signText } from "@/render/scene/signText.ts";
import { TRAIL } from "@/render/scene/trail.ts";
import { VIGNETTE, vignetteAlpha } from "@/render/scene/vignette.ts";
import { SOFT_DOT_SCALE, softDotCanvas } from "@/render/softDot.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { DEFAULT_TUNING, type Tuning } from "@/sim/tuning.ts";

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
  #assets: AssetBundle;
  readonly #effects: Effects;
  readonly #tuning: Tuning;
  readonly #stress: number;
  #showHitboxes: boolean;
  #elapsed = 0;
  #lastFrameTime = 0;
  #destroyed = false;

  #textures = new TextureCache();
  /** Caches of an atlas that was swapped out, freed once a frame has been drawn without them. */
  #retired: TextureCache[] = [];
  readonly #filters = new SceneFilters();
  readonly #hud: PixiHud;

  // Layers.
  readonly #skyBottom = solidRect();
  readonly #skyTop: Sprite;
  readonly #skyFade: Texture | null;
  /** The corner darkening, over the scene and under the HUD; null where it could not be painted. */
  readonly #vignette: Sprite | null;
  /** One baked Graphics per `STAR_LAYERS` entry, moved as a whole each frame. */
  readonly #stars: Graphics[];
  readonly #starLayer = new Container();
  readonly #clouds = new Container();
  readonly #cloudPool: Graphics[] = [];
  /** One baked outline per `CLOUD_SHAPES` entry, shared by every cloud drawn with it. */
  readonly #cloudShapes = CLOUD_SHAPES.map(bakeCloud);
  /** The horizon's glow: the fade texture stood on its head, null where it could not be made. */
  readonly #glow: Sprite | null;
  readonly #hills = new Container();
  /** Two tiles per `HILL_LAYERS` entry, sharing one baked silhouette. */
  readonly #hillTiles: Graphics[][];
  readonly #hillShapes = HILL_LAYERS.map(bakeHill);
  readonly #tuftShape = bakeTufts();
  readonly #tuftTiles = [new Graphics(this.#tuftShape), new Graphics(this.#tuftShape)];
  /** Sky plus world. Filters hang here so the HUD is never blurred or tinted. */
  readonly #scene = new Container();
  readonly #world = new Container();
  readonly #bushes = new Container();
  readonly #markers = new Container();
  readonly #powerups = new Container();
  readonly #fxLayer = new Container();
  readonly #particleLayer = new Container();
  /** The speed streak, redrawn each frame from a handful of segments. */
  readonly #trail = new Graphics();
  /** The particles' soft dot; null where it could not be painted, and they are squares. */
  readonly #dot: Texture | null;
  /** Follows the world but sits outside the filtered scene, like the Canvas2D overlay. */
  readonly #overlay = new Container();
  readonly #debugBoxes = new Graphics();
  /** The launcher and the queue, over the bushes and under the markers. */
  readonly #launcher = new Container();
  readonly #shadowPivot = new Container();
  readonly #shadow = new Sprite();
  readonly #hamsterPivot = new Container();
  /** Drawn under the bubble, so the hamster stays visible. */
  readonly #hamsterInner = new Sprite();
  readonly #hamster = new Sprite();
  /** The sign's two fields, `distance1_txt` then `distance_txt`. */
  readonly #signs: Text[] = [];
  readonly #signAscent: number;
  readonly #ballBadge = new Text({
    text: "",
    anchor: 0.5,
    style: new TextStyle({
      fontFamily: FONTS.ui,
      fontSize: BALL_BADGE.size,
      fontWeight: "700",
      fill: BALL_BADGE.fill,
      stroke: { color: BALL_BADGE.stroke, width: BALL_BADGE.strokeWidth, join: "round" },
    }),
  });

  // Pools.
  readonly #bushPool: Sprite[] = [];
  readonly #powerupPool: Sprite[] = [];
  readonly #fxPool: Sprite[] = [];
  readonly #particlePool: Sprite[] = [];
  readonly #markerTicks: Sprite[] = [];
  readonly #markerLabels: Text[] = [];
  readonly #launcherPool: Sprite[] = [];
  #markerAscent: number;

  // The page's overlay: the flags and the ghost.
  readonly #flags = new Container();
  readonly #flagPoles: Sprite[] = [];
  readonly #flagCloths: Graphics[] = [];
  readonly #flagLabels: Text[] = [];
  readonly #clothShapes: Record<FlagKind, GraphicsContext> = {
    record: bakeCloth(FLAG.colour.record),
    ghost: bakeCloth(FLAG.colour.ghost),
  };
  #flagAscent: number;
  readonly #ghostPivot = new Container();
  readonly #ghost = new Sprite();

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
    this.#hud = new PixiHud(
      assets,
      this.#textures,
      launchZones(this.#tuning),
      options.touch ?? false,
      options.strings,
    );
    this.#markerAscent = CanvasTextMetrics.measureFont(FONTS.marker).ascent;
    this.#signAscent = CanvasTextMetrics.measureFont(SIGN_TEXT.font).ascent;
    this.#flagAscent = CanvasTextMetrics.measureFont(FLAG.font).ascent;

    this.#skyFade = verticalFadeTexture();
    this.#skyTop = this.#skyFade === null ? solidRect() : new Sprite(this.#skyFade);
    this.#stars = this.#bakeStars();
    const ramp = vignetteTexture();
    this.#vignette = ramp === null ? null : new Sprite(ramp);
    const dot = softDotCanvas();
    this.#dot = dot === null ? null : Texture.from(dot);
    this.#glow = this.#skyFade === null ? null : bakeGlow(this.#skyFade);
    this.#hillTiles = this.#hillShapes.map((shape) => [new Graphics(shape), new Graphics(shape)]);

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
      resolution: elementScale(canvas),
      backgroundAlpha: 1,
      // The sim never reads the pointer; input is bound to the canvas element.
      eventMode: "none",
      // `SceneFilter` ships a GLSL program only. Auto-detection tries WebGL
      // first anyway, but a machine where WebGL fails and WebGPU succeeds
      // would boot and then throw on the first impact; pin it so it fails
      // over to Canvas2D at start-up instead, where main.ts catches it.
      preference: "webgl",
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
    this.#starLayer.addChild(...this.#stars);
    for (const tile of this.#hillTiles.flat()) this.#hills.addChild(tile);
    sky.addChild(this.#skyBottom, this.#skyTop, this.#starLayer, this.#clouds);
    if (this.#glow !== null) sky.addChild(this.#glow);
    sky.addChild(this.#hills);
    this.#scene.addChild(sky);
    // The filters centre their effects on screen fractions and the ground slab
    // always covers the view, so the scene's filter area is the viewport. Said
    // explicitly, it stops depending on the ground geometry and saves Pixi a
    // bounds walk on every filtered frame.
    this.#scene.filterArea = new Rectangle(0, 0, C.VIEW_W, C.VIEW_H);
    stage.addChild(this.#scene);
    if (this.#vignette !== null) {
      this.#vignette.width = C.VIEW_W;
      this.#vignette.height = C.VIEW_H;
      this.#vignette.tint = rgbInt(VIGNETTE.colour);
      stage.addChild(this.#vignette);
    }

    // Ground is two slabs the width of the whole course; static, so built once.
    const ground = new Container();
    for (const g of GROUND_SLABS) ground.addChild(slab(g.x, g.y, g.w, g.h, g.colour));
    ground.addChild(...this.#tuftTiles);

    this.#shadowPivot.addChild(this.#shadow);
    for (let i = 0; i < 2; i++) {
      const text = new Text({
        text: "",
        style: new TextStyle({
          fontFamily: FONTS.sans,
          fontSize: SIGN_TEXT.size,
          fontWeight: "bold",
        }),
      });
      text.visible = false;
      this.#signs.push(text);
    }
    this.#hamsterPivot.addChild(this.#hamsterInner, this.#hamster, ...this.#signs);
    this.#ghostPivot.addChild(this.#ghost);
    this.#ghostPivot.alpha = GHOST_ALPHA;
    this.#ghostPivot.visible = false;
    this.#world.addChild(
      ground,
      this.#bushes,
      this.#launcher,
      this.#markers,
      this.#flags,
      this.#powerups,
      this.#fxLayer,
      this.#particleLayer,
      this.#trail,
      this.#shadowPivot,
      this.#ghostPivot,
      this.#hamsterPivot,
      this.#ballBadge,
    );
    this.#scene.addChild(this.#world);
    this.#overlay.addChild(this.#debugBoxes);
    stage.addChild(this.#overlay);
    stage.addChild(this.#hud.container);

    this.#bindShadow();
  }

  /** The shadow is set up once rather than per frame, so an atlas swap sets it again. */
  #bindShadow(): void {
    const shadow = this.#assets.get("shadow");
    if (shadow === undefined) return;
    const texture = this.#textures.get(shadow, 0);
    if (texture !== undefined) this.#shadow.texture = texture;
    place(this.#shadow, shadow, 0, 0);
    this.#shadow.alpha = SHADOW_ALPHA;
  }

  setAssets(assets: AssetBundle): void {
    if (this.#destroyed || assets === this.#assets) return;
    // Every visible sprite takes its texture afresh on each draw, so the old
    // cache is only kept until one frame has gone to the GPU without it.
    this.#retired.push(this.#textures);
    this.#textures = new TextureCache();
    this.#assets = assets;
    this.#hud.setAssets(assets, this.#textures);
    this.#bindShadow();
  }

  /**
   * The star field is a fixed hash, so it is geometry rather than per-frame
   * work: one Graphics per depth layer, each a single batch however many stars
   * it holds. The parallax moves the Graphics, not the stars, so every star is
   * baked four times - the layer's 600 x 400 tile and its neighbours right,
   * below and diagonally - and the layer is placed a tile up and left of its
   * wrapped offset, which keeps the screen covered wherever the offset falls.
   */
  #bakeStars(): Graphics[] {
    const layers = STAR_LAYERS.map(() => new Graphics());
    for (const star of starField(this.#stress)) {
      const g = layers[star.layer];
      if (g === undefined) continue;
      for (const [tx, ty] of [
        [0, 0],
        [C.VIEW_W, 0],
        [0, C.VIEW_H],
        [C.VIEW_W, C.VIEW_H],
      ] as const) {
        g.circle(star.x + tx, star.y + ty, star.r);
      }
    }
    for (const g of layers) g.fill(0xffffff);
    return layers;
  }

  // -- lifecycle -------------------------------------------------------------

  resize(): void {
    if (this.#destroyed) return;
    // One call: setting `resolution` separately re-sized the render target
    // twice. `autoDensity` is off, so Pixi never touches the CSS size here.
    this.#app.renderer.resize(C.VIEW_W, C.VIEW_H, elementScale(this.#canvas));
  }

  resync(): void {
    this.#lastFrameTime = 0;
  }

  toggleHitboxes(): void {
    this.#showHitboxes = !this.#showHitboxes;
  }

  setStrings(strings: HudStrings): void {
    // Pixi caches font metrics by font string, and the string is the same
    // before and after a late face arrives - so the cache has to go, or every
    // measurement below would still be the fallback's.
    CanvasTextMetrics.clearMetrics();
    this.#hud.setStrings(strings);
    // Also the call that follows a late font: re-measure, and empty every
    // label so the next draw renders it again in the face now live.
    this.#markerAscent = CanvasTextMetrics.measureFont(FONTS.marker).ascent;
    this.#flagAscent = CanvasTextMetrics.measureFont(FLAG.font).ascent;
    for (const label of [...this.#markerLabels, ...this.#flagLabels, this.#ballBadge]) {
      label.text = "";
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#filters.destroy(this.#scene);
    this.#textures.destroy();
    for (const old of this.#retired.splice(0)) old.destroy();
    this.#skyFade?.destroy(true);
    this.#vignette?.texture.destroy(true);
    for (const shape of this.#cloudShapes) shape.destroy();
    this.#clothShapes.record.destroy();
    this.#clothShapes.ghost.destroy();
    this.#app.destroy({ removeView: false }, { children: true });
  }

  // -- frame -----------------------------------------------------------------

  draw(s: SimSnapshot, now: number, overlay: Overlay = NO_OVERLAY): void {
    if (this.#destroyed) return;
    if (this.#lastFrameTime !== 0) this.#elapsed += now - this.#lastFrameTime;
    this.#lastFrameTime = now;

    this.#sky(s);
    if (this.#vignette !== null) this.#vignette.alpha = vignetteAlpha(altitudeOf(s));
    // Impact shake rides on the camera, so the HUD and the sky stay still.
    const shake = this.#effects.shakeOffset(now);
    const offsetX = s.camera.x + shake.x;
    const offsetY = s.camera.y + shake.y;
    this.#world.position.set(offsetX, offsetY);
    this.#overlay.position.set(offsetX, offsetY);
    const scene = this.#effects.scene.layout(s, now);
    this.#ground(s);
    this.#drawFlags(s, overlay);
    this.#drawGhost(overlay.ghost);
    this.#drawScene(scene);
    this.#drawPowerups(s);
    this.#drawFx(now);
    this.#drawParticles(now);
    this.#drawTrail(s);
    this.#drawHamster(s);
    this.#hud.draw(s, this.#showHitboxes);
    this.#filters.apply(this.#scene, s, this.#effects, now, offsetX, offsetY);
    if (this.#showHitboxes) this.#drawHitboxes(s);
    else this.#debugBoxes.clear();

    this.#app.renderer.render(this.#app.stage);
    for (const old of this.#retired.splice(0)) old.destroy();
  }

  #sky(s: SimSnapshot): void {
    const sky = skyColours(altitudeOf(s));
    // Two stops, so a static top-to-bottom alpha ramp tinted with the top
    // colour over a slab of the bottom colour reproduces the Canvas2D gradient
    // exactly - and without allocating a FillGradient every frame.
    this.#skyBottom.tint = rgbInt(sky.bottom);
    this.#skyTop.tint = rgbInt(sky.top);
    this.#starLayer.visible = sky.starAlpha > 0;
    if (sky.starAlpha > 0) {
      this.#starLayer.alpha = sky.starAlpha;
      for (const [i, g] of this.#stars.entries()) {
        const off = starOffset(s.camera, STAR_LAYERS[i]?.parallax ?? 0);
        g.position.set(off.x - C.VIEW_W, off.y - C.VIEW_H);
      }
    }

    let used = 0;
    if (cloudAlpha(sky) > 0) {
      for (const cloud of clouds(s.camera, this.#stress)) {
        const shape = this.#cloudShapes[cloud.shape];
        if (shape === undefined) continue;
        const g = poolAt(this.#cloudPool, used++, this.#clouds, () => new Graphics());
        if (g.context !== shape) g.context = shape;
        g.position.set(cloud.x, cloud.y);
        g.scale.set(cloud.scale);
        // The shade is baked as `CLOUD_SHADE`, so the tint lands it on
        // `cloudColours().shade` - the Canvas2D colour - by multiplication.
        g.tint = rgbInt(cloudColours(sky, cloud.y).lit);
        g.visible = true;
      }
    }
    hideFrom(this.#cloudPool, used);

    const horizon = horizonY(s.camera);
    if (this.#glow !== null) {
      const alpha = horizonGlowAlpha(altitudeOf(s));
      this.#glow.visible = horizonGlowVisible(alpha, horizon);
      this.#glow.alpha = alpha;
      this.#glow.position.set(0, horizon);
    }
    for (const [i, layer] of HILL_LAYERS.entries()) {
      const origins = tileOrigins(s.camera.x, layer.parallax, HILL_TILE);
      const colour = rgbInt(hillColour(layer, sky));
      const visible = hillVisible(layer, horizon);
      for (const [k, tile] of (this.#hillTiles[i] ?? []).entries()) {
        tile.visible = visible;
        tile.position.set(origins[k] ?? 0, horizon);
        tile.tint = colour;
      }
    }
  }

  #ground(s: SimSnapshot): void {
    const origins = worldTileOrigins(s.camera.x, TUFT_TILE);
    for (const [k, tile] of this.#tuftTiles.entries())
      tile.position.set(origins[k] ?? 0, GROUND.y + 1);

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

    const marks = markers(s.camera.x);
    for (const [i, x] of marks.ticks.entries()) {
      const tick = this.#tickAt(i);
      tick.position.set(x, GROUND.y - 7);
      tick.visible = true;
    }
    hideFrom(this.#markerTicks, marks.ticks.length);
    for (const [i, label] of marks.labels.entries()) {
      const text = this.#labelAt(i);
      if (text.text !== label.text) text.text = label.text;
      text.position.set(label.x + 3, GROUND.y - 10 - this.#markerAscent);
      text.visible = true;
    }
    hideFrom(this.#markerLabels, marks.labels.length);
  }

  /** The record and the ghost's shot, planted where they came down. */
  #drawFlags(s: SimSnapshot, overlay: Overlay): void {
    const flags = visibleFlags(overlay.flags, s.camera.x);
    const lifts = labelOffsets(flags);
    for (const [i, flag] of flags.entries()) {
      const { pole } = flagGeometry(flag.x);
      const stick = poolAt(this.#flagPoles, i, this.#flags, solidRect);
      stick.tint = 0xe8eef5;
      stick.position.set(pole[0], pole[1]);
      stick.width = pole[2];
      stick.height = pole[3];
      stick.visible = true;
      const cloth = poolAt(this.#flagCloths, i, this.#flags, () => new Graphics());
      const shape = this.#clothShapes[flag.kind];
      if (cloth.context !== shape) cloth.context = shape;
      cloth.position.set(flag.x + FLAG.poleW / 2, pole[1]);
      cloth.visible = true;
      const label = poolAt(this.#flagLabels, i, this.#flags, flagText);
      if (label.text !== flag.label) label.text = flag.label;
      label.position.set(
        flag.x + FLAG.labelDx,
        C.GROUND_Y - FLAG.labelDy - (lifts[i] ?? 0) - this.#flagAscent,
      );
      label.visible = true;
    }
    hideFrom(this.#flagPoles, flags.length);
    hideFrom(this.#flagCloths, flags.length);
    hideFrom(this.#flagLabels, flags.length);
  }

  /** The ghost: the pose it was in, first frame, see-through. */
  #drawGhost(ghost: GhostPose | null): void {
    const asset = ghost === null ? undefined : this.#assets.get(ghost.pose);
    const texture = asset === undefined ? undefined : this.#textures.get(asset, 0);
    if (ghost === null || asset === undefined || texture === undefined) {
      this.#ghostPivot.visible = false;
      return;
    }
    this.#ghostPivot.visible = true;
    this.#ghostPivot.position.set(ghost.x, ghost.y);
    this.#ghostPivot.rotation = (ghost.rotationDeg * Math.PI) / 180;
    this.#ghost.texture = texture;
    this.#ghost.alpha = poseAlpha(asset.meta);
    placeInParent(this.#ghost, asset);
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
        sprite.alpha = item.taken ? POWERUP_TAKEN_ALPHA : 1;
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
    const dot = this.#dot;
    for (const p of this.#effects.particles(now)) {
      const sprite = poolAt(this.#particlePool, used++, this.#particleLayer, () =>
        dot === null ? solidRect() : new Sprite(dot),
      );
      const d = dot === null ? p.size : p.size * SOFT_DOT_SCALE;
      sprite.position.set(p.x - d / 2, p.y - d / 2);
      sprite.width = d;
      sprite.height = d;
      sprite.tint = p.tint;
      sprite.blendMode = p.glow ? "add" : "normal";
      sprite.alpha = particleAlpha(p);
      sprite.visible = true;
    }
    hideFrom(this.#particlePool, used);
  }

  /** The streak behind a fast hamster, from where the last few ticks put it. */
  #drawTrail(s: SimSnapshot): void {
    this.#trail.clear();
    if (s.phaseKind !== "flying") return;
    for (const seg of this.#effects.trail(s.hamster)) {
      this.#trail
        .moveTo(seg.x0, seg.y0)
        .lineTo(seg.x1, seg.y1)
        .stroke({ width: seg.width, color: TRAIL.colour, alpha: seg.alpha, cap: "round" });
    }
  }

  #drawHamster(s: SimSnapshot): void {
    const h = s.hamster;
    this.#ballBadge.visible = false;
    if (!h.visible && s.phaseKind !== "settling") {
      this.#hamsterPivot.visible = false;
      this.#shadowPivot.visible = false;
      return;
    }

    const scale = hamsterShadow(s);
    const showShadow = this.#assets.get("shadow") !== undefined && scale !== null;
    this.#shadowPivot.visible = showShadow;
    if (showShadow) {
      this.#shadowPivot.position.set(h.x, C.SHADOW_Y);
      this.#shadowPivot.scale.set(scale);
    }

    const pose = poseFor(s);
    const asset = this.#assets.get(pose);
    const frame = asset === undefined ? 0 : this.#effects.poses.frame(s, asset.meta, this.#elapsed);
    const texture = asset === undefined ? undefined : this.#textures.get(asset, frame);
    if (asset === undefined || texture === undefined) {
      this.#hamsterPivot.visible = false;
      return;
    }
    this.#drawSign(s, pose, frame);
    const badge = ballBadge(s);
    if (badge !== null) {
      if (this.#ballBadge.text !== badge) this.#ballBadge.text = badge;
      this.#ballBadge.position.set(h.x + BALL_BADGE.dx, h.y + BALL_BADGE.dy);
      this.#ballBadge.visible = true;
    }

    // The bubble is opaque in the original, so the hamster vanishes inside it
    // for the whole bounce. The port draws the flier underneath.
    const inBubble = isBallPose(pose);
    this.#hamsterInner.visible = inBubble;
    this.#hamster.alpha = poseAlpha(asset.meta) * (inBubble ? BUBBLE_ALPHA : 1);
    if (inBubble) {
      const inside = this.#assets.get("hamster/fly");
      const insideTexture =
        inside === undefined
          ? undefined
          : this.#textures.get(inside, this.#effects.poses.innerFrame(inside.meta, this.#elapsed));
      if (inside !== undefined && insideTexture !== undefined) {
        this.#hamsterInner.texture = insideTexture;
        placeInParent(this.#hamsterInner, inside);
      } else {
        this.#hamsterInner.visible = false;
      }
    }

    this.#hamsterPivot.visible = true;
    this.#hamsterPivot.position.set(h.x, h.y + outcomeOffsetY(s));
    this.#hamsterPivot.rotation = hamsterRotation(s);
    this.#hamster.texture = texture;
    placeInParent(this.#hamster, asset);
  }

  /** The distance on the outcome clip's sign, placed in the clip's own space. */
  #drawSign(s: SimSnapshot, pose: SpriteId, frame: number): void {
    const text = signText(s, pose, frame);
    const fields = signFields(pose);
    this.#signs.forEach((sign, i) => {
      const field = fields[i];
      sign.visible = text !== null && field !== undefined;
      if (text === null || field === undefined) return;
      if (sign.text !== text) sign.text = text;
      sign.style.fill = field.colour;
      // Measured unsqueezed: `width` is local, before the matrix below.
      const squeeze = signScaleX(text, sign.getLocalBounds().width);
      const [a, b, c, d, tx, ty] = field.matrix;
      sign.setFromMatrix(
        new Matrix(a, b, c, d, tx, ty)
          .append(new Matrix(squeeze, 0, 0, 1, SIGN_TEXT.centreX, SIGN_TEXT.baseline))
          .append(new Matrix(1, 0, 0, 1, -sign.getLocalBounds().width / 2, -this.#signAscent)),
      );
    });
  }

  #drawHitboxes(s: SimSnapshot): void {
    const g = this.#debugBoxes;
    g.clear();
    for (const item of s.powerups) {
      g.rect(...boxRect(item.x, item.y, this.#tuning.boxes.powerups[item.kind]));
    }
    g.stroke({ color: HUD_COLOURS.hitboxPowerup, width: 1 });

    g.rect(...boxRect(s.hamster.x, s.hamster.y, hamsterBox(s, this.#tuning)));
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
        text: "",
        style: new TextStyle({
          fontFamily: FONTS.ui,
          fontSize: HUD_TYPE.marker.size,
          fontWeight: HUD_TYPE.marker.weight,
          letterSpacing: HUD_TYPE.marker.letterSpacing,
          fill: HUD_COLOURS.markerInk,
        }),
      });
      label.alpha = HUD_COLOURS.markerAlpha;
      return label;
    });
  }
}

/** A flag's cloth, its pole-side edge at the origin. */
function bakeCloth(colour: number): GraphicsContext {
  return new GraphicsContext()
    .poly([0, 0, FLAG.clothW, FLAG.clothH / 2, 0, FLAG.clothH])
    .fill(colour);
}

function flagText(): Text {
  return new Text({
    text: "",
    style: new TextStyle({
      fontFamily: FONTS.ui,
      fontSize: FLAG.fontSize,
      fontWeight: "700",
      fill: FLAG.ink,
      stroke: { color: FLAG.stroke, width: 3, join: "round" },
    }),
  });
}

/** One tile of a hill silhouette, white so a tint colours it. */
function bakeHill(layer: HillLayer): GraphicsContext {
  return new GraphicsContext().poly([...hillProfile(layer)]).fill(0xffffff);
}

/** One tile of grass tufts on the edge, in the edge's colour. */
function bakeTufts(): GraphicsContext {
  const g = new GraphicsContext();
  for (const tuft of tufts()) {
    for (const blade of tuftBlades(tuft)) g.poly([...blade]).fill(TUFT_COLOUR);
  }
  return g;
}

/** The glow sprite: opaque at the horizon, fading upwards, in the glow's colour. */
function bakeGlow(fade: Texture): Sprite {
  const glow = new Sprite(fade);
  glow.tint = rgbInt(HORIZON_GLOW.colour);
  glow.scale.set(C.VIEW_W / fade.width, -HORIZON_GLOW.height / fade.height);
  return glow;
}

/** A cloud outline as reusable geometry: the shaded underside, then the lit top over it. */
function bakeCloud(shape: CloudShape): GraphicsContext {
  const g = new GraphicsContext();
  const [x, width] = shape.base;
  for (const [drop, colour] of [
    [CLOUD_SHADE_DROP, rgbInt(CLOUD_SHADE)],
    [0, 0xffffff],
  ] as const) {
    g.roundRect(x, drop - CLOUD_BASE_H, width, CLOUD_BASE_H, CLOUD_BASE_H / 2).fill(colour);
    for (const [dx, dy, r] of shape.puffs) g.circle(dx, dy + drop, r).fill(colour);
  }
  return g;
}

export function createPixiRenderer(
  canvas: HTMLCanvasElement,
  assets: AssetBundle,
  effects: Effects,
  options: RendererOptions = {},
): Promise<Renderer> {
  return PixiRenderer.create(canvas, assets, effects, options);
}
