import type { AssetBundle, Sprite } from "@/assets/AssetLoader.ts";
import type { SpriteId } from "@/assets/sprites.generated.ts";
import type { Effects } from "@/render/effects/Effects.ts";
import type { PreLaunchLayout } from "@/render/PreLaunchScene.ts";
import type { Renderer, RendererOptions } from "@/render/Renderer.ts";
import { stageScale } from "@/render/resolution.ts";
import {
  altitudeOf,
  BUBBLE_ALPHA,
  bushes,
  CLOUD_BASE_H,
  CLOUD_SHADE_DROP,
  CLOUD_SHAPES,
  type CloudShape,
  cloudAlpha,
  cloudColours,
  clouds,
  GROUND,
  GROUND_BANDS,
  PARTICLE_DUST_ALPHA,
  HILL_LAYERS,
  HILL_TILE,
  HORIZON_GLOW,
  hillColour,
  hillProfile,
  horizonGlowAlpha,
  horizonY,
  markers,
  POWERUP_IDLE_FRAME,
  POWERUP_SPRITE,
  rgbCss,
  SHADOW_ALPHA,
  SHADOW_MIN_SCALE,
  type Star,
  shadowScale,
  skyColours,
  TUFT_COLOUR,
  TUFT_TILE,
  tileOrigins,
  tuftBlades,
  tufts,
  worldTileOrigins,
  starAt,
  starField,
} from "@/render/scene/decor.ts";
import {
  BALL_BADGE,
  ballBadge,
  debugLines,
  FONTS,
  EN_HUD,
  glideFill,
  HUD,
  HUD_COLOURS,
  HUD_TYPE,
  type HudStrings,
  ITEM_COLOURS,
  launchZones,
  type LaunchZones,
  meterReading,
  minimapModel,
  panelFields,
  pipFrames,
  promptFor,
  triesLabel,
} from "@/render/scene/hud.ts";
import {
  FLAG,
  flagGeometry,
  GHOST_ALPHA,
  type GhostPose,
  labelOffsets,
  NO_OVERLAY,
  type Overlay,
  visibleFlags,
} from "@/render/scene/overlay.ts";
import {
  castsShadow,
  hamsterBox,
  hamsterRotation,
  isBallPose,
  outcomeOffsetY,
  poseAlpha,
  posePlacement,
  poseFor,
} from "@/render/scene/pose.ts";
import { SIGN_TEXT, signFields, signScaleX, signText } from "@/render/scene/signText.ts";
import { TRAIL } from "@/render/scene/trail.ts";
import { VIGNETTE, VIGNETTE_STOPS, vignetteAlpha } from "@/render/scene/vignette.ts";
import { SOFT_DOT_SCALE, softDotCanvas } from "@/render/softDot.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { DEFAULT_TUNING, type Tuning } from "@/sim/tuning.ts";

function rgba(colour: number, alpha: number): string {
  return `rgba(${(colour >> 16) & 255},${(colour >> 8) & 255},${colour & 255},${alpha})`;
}

const CHROME = rgba(HUD_COLOURS.chrome, HUD_COLOURS.chromeAlpha);
const PROMPT_CHROME = rgba(HUD_COLOURS.chrome, HUD_COLOURS.promptAlpha);
const RIM = rgba(HUD_COLOURS.rim, HUD_COLOURS.rimAlpha);
const SHADOW = rgba(HUD_COLOURS.shadow, HUD_COLOURS.shadowAlpha);
const GLOSS = rgba(HUD_COLOURS.gloss, HUD_COLOURS.glossAlpha);
const DIVIDER = rgba(HUD_COLOURS.divider, HUD_COLOURS.dividerAlpha);
/** The glide track, darker than the card it sits in. */
const TRACK = rgba(0x000000, 0.32);
const MARKER_INK = `rgba(255,255,255,${HUD_COLOURS.markerAlpha})`;

/** A rounded rectangle as the current path; a square one where roundRect is missing. */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}

/** A HUD card: translucent chrome with a hairline rim. */
function card(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill = CHROME,
): void {
  roundedPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  roundedPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r - 0.5);
  ctx.strokeStyle = RIM;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Letter spacing where the canvas has it; older engines just set it tight. */
function setSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
}

/** One path for the whole outline: every sub-shape winds the same way, so it fills as a union. */
function cloudPath(ctx: CanvasRenderingContext2D, shape: CloudShape, drop: number): void {
  const [x, width] = shape.base;
  ctx.beginPath();
  ctx.roundRect(x, drop - CLOUD_BASE_H, width, CLOUD_BASE_H, CLOUD_BASE_H / 2);
  for (const [dx, dy, r] of shape.puffs) {
    ctx.moveTo(dx + r, dy + drop);
    ctx.arc(dx, dy + drop, r, 0, Math.PI * 2);
  }
}

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
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
  #assets: AssetBundle;
  readonly #effects: Effects;
  readonly #tuning: Tuning;
  readonly #zones: LaunchZones;
  readonly #stress: number;
  /** A fixed hash, so it is built once; rebuilding it every frame allocated
   *  `70 * stress` objects per draw for a picture that never changes. */
  readonly #stars: readonly Star[];
  readonly #tufts = tufts();
  /** The soft dot for particles: undefined until first wanted, null where it cannot be painted. */
  #dot: HTMLCanvasElement | null | undefined;
  readonly #dots = new Map<number, HTMLCanvasElement>();
  #dpr = 1;
  #showHitboxes: boolean;
  readonly #touch: boolean;
  #strings: HudStrings;
  /** Wall-clock milliseconds, for animations that are not physics. */
  #elapsed = 0;
  #lastFrameTime = 0;

  constructor(
    canvas: HTMLCanvasElement,
    assets: AssetBundle,
    effects: Effects,
    options: RendererOptions = {},
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (ctx === null) throw new Error("2D canvas context unavailable");
    this.#ctx = ctx;
    this.#canvas = canvas;
    this.#assets = assets;
    this.#effects = effects;
    this.#tuning = options.tuning ?? DEFAULT_TUNING;
    this.#zones = launchZones(this.#tuning);
    this.#showHitboxes = options.showHitboxes ?? false;
    this.#touch = options.touch ?? false;
    this.#strings = options.strings ?? EN_HUD;
    this.#stress = Math.max(1, Math.floor(options.stress ?? 1));
    this.#stars = starField(this.#stress);
    this.resize();
  }

  resize(): void {
    this.#dpr = stageScale(this.#canvas.getBoundingClientRect().width, window.devicePixelRatio);
    this.#canvas.width = Math.round(C.VIEW_W * this.#dpr);
    this.#canvas.height = Math.round(C.VIEW_H * this.#dpr);
    this.#ctx.imageSmoothingQuality = "high";
  }

  resync(): void {
    this.#lastFrameTime = 0;
  }

  toggleHitboxes(): void {
    this.#showHitboxes = !this.#showHitboxes;
  }

  setAssets(assets: AssetBundle): void {
    // Immediate mode: the next frame simply draws from the new sheet.
    this.#assets = assets;
  }

  setStrings(strings: HudStrings): void {
    this.#strings = strings;
  }

  /** Immediate mode holds no GPU objects, so there is nothing to release. */
  destroy(): void {}

  draw(s: SimSnapshot, now: number, overlay: Overlay = NO_OVERLAY): void {
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
    this.#flags(ctx, s, overlay);
    this.#powerups(ctx, s);
    this.#fx(ctx, now);
    this.#particles(ctx, now);
    this.#trail(ctx, s);
    if (overlay.ghost !== null) this.#ghost(ctx, overlay.ghost);
    this.#hamster(ctx, s);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.#vignette(ctx, altitudeOf(s));
    this.#hud(ctx, s);
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
      ctx.fillStyle = "#fff";
      for (const star of this.#stars) {
        const at = starAt(star, s.camera);
        ctx.beginPath();
        ctx.arc(at.x, at.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (cloudAlpha(sky) > 0) {
      for (const cloud of clouds(s.camera, this.#stress)) {
        const shape = CLOUD_SHAPES[cloud.shape];
        if (shape === undefined) continue;
        const colours = cloudColours(sky, cloud.y);
        ctx.save();
        ctx.translate(cloud.x, cloud.y);
        ctx.scale(cloud.scale, cloud.scale);
        cloudPath(ctx, shape, CLOUD_SHADE_DROP);
        ctx.fillStyle = rgbCss(colours.shade);
        ctx.fill();
        cloudPath(ctx, shape, 0);
        ctx.fillStyle = rgbCss(colours.lit);
        ctx.fill();
        ctx.restore();
      }
    }

    const horizon = horizonY(s.camera);
    if (horizon <= 0) return;
    const glow = horizonGlowAlpha(altitudeOf(s));
    if (glow > 0 && horizon - HORIZON_GLOW.height < C.VIEW_H) {
      const [r, g, b] = HORIZON_GLOW.colour;
      const fade = ctx.createLinearGradient(0, horizon - HORIZON_GLOW.height, 0, horizon);
      fade.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      fade.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${glow})`);
      ctx.fillStyle = fade;
      ctx.fillRect(0, horizon - HORIZON_GLOW.height, C.VIEW_W, HORIZON_GLOW.height);
    }
    for (const layer of HILL_LAYERS) {
      if (horizon - layer.height >= C.VIEW_H) continue;
      const profile = hillProfile(layer);
      ctx.fillStyle = rgbCss(hillColour(layer, sky));
      for (const origin of tileOrigins(s.camera.x, layer.parallax, HILL_TILE)) {
        ctx.beginPath();
        for (let i = 0; i < profile.length; i += 2) {
          const x = origin + (profile[i] ?? 0);
          const y = horizon + (profile[i + 1] ?? 0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** The corner darkening: the same radial ramp the WebGL backend stretches over the stage. */
  #vignette(ctx: CanvasRenderingContext2D, altitude: number): void {
    const [r, g, b] = VIGNETTE.colour;
    const alpha = vignetteAlpha(altitude);
    // The ramp is defined over the unit square, so draw it there and let the
    // transform (already scaled by the density) stretch the circle into the
    // stage's ellipse.
    ctx.save();
    ctx.scale(C.VIEW_W, C.VIEW_H);
    const gradient = ctx.createRadialGradient(0.5, 0.5, VIGNETTE.inner, 0.5, 0.5, VIGNETTE.outer);
    for (const [offset, share] of VIGNETTE_STOPS) {
      gradient.addColorStop(offset, `rgba(${r}, ${g}, ${b}, ${share * alpha})`);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
  }

  #ground(ctx: CanvasRenderingContext2D, s: SimSnapshot, scene: PreLaunchLayout): void {
    ctx.fillStyle = hex(GROUND.colour);
    ctx.fillRect(GROUND.x, GROUND.y, GROUND.width, GROUND.height);
    for (const [i, band] of GROUND_BANDS.entries()) {
      const end = GROUND_BANDS[i + 1]?.dy ?? GROUND.height;
      ctx.fillStyle = hex(band.colour);
      ctx.fillRect(GROUND.x, GROUND.y + band.dy, GROUND.width, end - band.dy);
    }
    ctx.fillStyle = hex(GROUND.lipColour);
    ctx.fillRect(GROUND.x, GROUND.y, GROUND.width, GROUND.lip);

    ctx.fillStyle = hex(TUFT_COLOUR);
    ctx.beginPath();
    for (const origin of worldTileOrigins(s.camera.x, TUFT_TILE)) {
      for (const tuft of this.#tufts) {
        for (const blade of tuftBlades(tuft)) {
          ctx.moveTo(origin + (blade[0] ?? 0), GROUND.y + 1 + (blade[1] ?? 0));
          ctx.lineTo(origin + (blade[2] ?? 0), GROUND.y + 1 + (blade[3] ?? 0));
          ctx.lineTo(origin + (blade[4] ?? 0), GROUND.y + 1 + (blade[5] ?? 0));
          ctx.closePath();
        }
      }
    }
    ctx.fill();

    for (const bush of bushes(s.camera.x, this.#stress)) {
      const sprite = this.#assets.get(bush.sprite);
      if (sprite !== undefined) this.#blit(ctx, sprite, 0, bush.x, bush.y);
    }

    for (const at of scene.world) {
      const sprite = this.#assets.get(at.sprite);
      if (sprite !== undefined) this.#blit(ctx, sprite, at.frame, at.x, at.y);
    }

    const marks = markers(s.camera.x);
    ctx.fillStyle = MARKER_INK;
    ctx.font = FONTS.marker;
    for (const x of marks.ticks) ctx.fillRect(x, GROUND.y - 7, 1, 7);
    for (const label of marks.labels) ctx.fillText(label.text, label.x + 3, GROUND.y - 10);
  }

  /** The record and the ghost's shot, planted where they came down. */
  #flags(ctx: CanvasRenderingContext2D, s: SimSnapshot, overlay: Overlay): void {
    const flags = visibleFlags(overlay.flags, s.camera.x);
    if (flags.length === 0) return;
    const lifts = labelOffsets(flags);
    ctx.save();
    ctx.font = FLAG.font;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    for (const [i, flag] of flags.entries()) {
      const { pole, cloth } = flagGeometry(flag.x);
      ctx.fillStyle = "#e8eef5";
      ctx.fillRect(...pole);
      ctx.fillStyle = hex(FLAG.colour[flag.kind]);
      ctx.beginPath();
      ctx.moveTo(cloth[0], cloth[1]);
      ctx.lineTo(cloth[2], cloth[3]);
      ctx.lineTo(cloth[4], cloth[5]);
      ctx.closePath();
      ctx.fill();
      const y = C.GROUND_Y - FLAG.labelDy - (lifts[i] ?? 0);
      ctx.strokeStyle = FLAG.stroke;
      ctx.strokeText(flag.label, flag.x + FLAG.labelDx, y);
      ctx.fillStyle = FLAG.ink;
      ctx.fillText(flag.label, flag.x + FLAG.labelDx, y);
    }
    ctx.restore();
  }

  /** The ghost: the pose it was in, first frame, see-through. */
  #ghost(ctx: CanvasRenderingContext2D, ghost: GhostPose): void {
    const sprite = this.#assets.get(ghost.pose);
    if (sprite === undefined) return;
    ctx.save();
    ctx.translate(ghost.x, ghost.y);
    ctx.rotate((ghost.rotationDeg * Math.PI) / 180);
    ctx.globalAlpha = GHOST_ALPHA * poseAlpha(sprite.meta);
    ctx.transform(...posePlacement(sprite.meta));
    this.#blit(ctx, sprite, 0, 0, 0);
    ctx.restore();
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
    const dot = this.#dot === undefined ? (this.#dot = softDotCanvas()) : this.#dot;
    for (const p of this.#effects.particles(now)) {
      ctx.globalAlpha = p.glow ? 1 - p.age : PARTICLE_DUST_ALPHA * (1 - p.age);
      ctx.globalCompositeOperation = p.glow ? "lighter" : "source-over";
      if (dot === null) {
        ctx.fillStyle = hex(p.tint);
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        continue;
      }
      const d = p.size * SOFT_DOT_SCALE;
      ctx.drawImage(this.#tinted(dot, p.tint), p.x - d / 2, p.y - d / 2, d, d);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  /** The soft dot in one colour, painted the first time it is asked for. */
  #tinted(dot: HTMLCanvasElement, tint: number): HTMLCanvasElement {
    let canvas = this.#dots.get(tint);
    if (canvas === undefined) {
      canvas = document.createElement("canvas");
      canvas.width = dot.width;
      canvas.height = dot.height;
      const c = canvas.getContext("2d");
      if (c !== null) {
        c.drawImage(dot, 0, 0);
        c.globalCompositeOperation = "source-in";
        c.fillStyle = hex(tint);
        c.fillRect(0, 0, canvas.width, canvas.height);
      }
      this.#dots.set(tint, canvas);
    }
    return canvas;
  }

  /** The streak behind a fast hamster, from where the last few ticks put it. */
  #trail(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    if (s.phaseKind !== "flying") return;
    const segments = this.#effects.trail(s.hamster);
    if (segments.length === 0) return;
    ctx.strokeStyle = hex(TRAIL.colour);
    ctx.lineCap = "round";
    for (const seg of segments) {
      ctx.globalAlpha = seg.alpha;
      ctx.lineWidth = seg.width;
      ctx.beginPath();
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(seg.x1, seg.y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
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
    if (!h.visible && s.phaseKind !== "settling") return;

    const shadow = this.#assets.get("shadow");
    const scale = castsShadow(s) ? shadowScale(h.y) : 0;
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
    // for the whole bounce. The port draws the flier underneath and lets the
    // bubble sit over it, translucent.
    const inBubble = isBallPose(id);
    const rotation = hamsterRotation(s);
    if (rotation !== 0) ctx.rotate(rotation);
    if (inBubble) {
      const inside = this.#assets.get("hamster/fly");
      if (inside !== undefined) {
        ctx.save();
        ctx.transform(...posePlacement(inside.meta));
        this.#blit(ctx, inside, this.#effects.poses.innerFrame(inside.meta, this.#elapsed), 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = poseAlpha(sprite.meta) * (inBubble ? BUBBLE_ALPHA : 1);
    ctx.transform(...posePlacement(sprite.meta));
    const frame = this.#effects.poses.frame(s, sprite.meta, this.#elapsed);
    this.#blit(ctx, sprite, frame, 0, 0);
    ctx.globalAlpha = 1;
    this.#sign(ctx, s, id, frame);
    ctx.restore();

    const badge = ballBadge(s);
    if (badge !== null) {
      ctx.save();
      ctx.font = BALL_BADGE.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = BALL_BADGE.strokeWidth;
      ctx.strokeStyle = BALL_BADGE.stroke;
      ctx.fillStyle = BALL_BADGE.fill;
      ctx.strokeText(badge, h.x + BALL_BADGE.dx, h.y + BALL_BADGE.dy);
      ctx.fillText(badge, h.x + BALL_BADGE.dx, h.y + BALL_BADGE.dy);
      ctx.restore();
    }

    if (this.#showHitboxes) {
      const box = hamsterBox(s, this.#tuning);
      ctx.strokeStyle = hex(HUD_COLOURS.hitboxHamster);
      ctx.lineWidth = 1;
      ctx.strokeRect(h.x + box.cx - box.hw, h.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
    }
  }

  /** The distance on the outcome clip's sign, drawn in the clip's own space. */
  #sign(ctx: CanvasRenderingContext2D, s: SimSnapshot, id: SpriteId, frame: number): void {
    const text = signText(s, id, frame);
    if (text === null) return;
    ctx.font = SIGN_TEXT.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const squeeze = signScaleX(text, ctx.measureText(text).width);
    for (const field of signFields(id)) {
      ctx.save();
      ctx.transform(...field.matrix);
      ctx.translate(SIGN_TEXT.centreX, SIGN_TEXT.baseline);
      ctx.scale(squeeze, 1);
      ctx.fillStyle = hex(field.colour);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  /**
   * Cuts one frame out of the atlas sheet and places it by the manifest
   * offsets. `w`/`h` are art pixels and `ox`/`oy` stage pixels, so the frame is
   * drawn at its stage size - which is how art packed above 1:1 stays put.
   */
  #blit(ctx: CanvasRenderingContext2D, sprite: Sprite, frame: number, x: number, y: number): void {
    const rect = sprite.frames[frame] ?? sprite.frames[0];
    if (rect === undefined) return;
    const density = sprite.density;
    ctx.drawImage(
      sprite.sheet,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      x + sprite.meta.ox,
      y + sprite.meta.oy,
      rect.w / density,
      rect.h / density,
    );
  }

  // -- HUD ------------------------------------------------------------------

  #hud(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    ctx.save();
    const bar = HUD.bar;
    card(ctx, bar.x, bar.y, bar.w, bar.h, bar.radius);
    ctx.fillStyle = DIVIDER;
    for (const x of HUD.dividers) ctx.fillRect(x, bar.y + 9, 1, bar.h - 18);
    const label = (text: string, x: number): void => {
      ctx.font = FONTS.label;
      setSpacing(ctx, HUD_TYPE.label.letterSpacing);
      ctx.fillStyle = HUD_COLOURS.labelInk;
      ctx.fillText(text, x, HUD.labelBaseline);
      setSpacing(ctx, 0);
    };

    // The tries: the original's five pips, in a row.
    const tries = HUD.tries;
    label(triesLabel(s, this.#strings), tries.labelX);
    const pip = this.#assets.get("hud/shotPip");
    if (pip !== undefined) {
      for (const [i, frame] of pipFrames(s).entries()) {
        const x = tries.pipX + i * tries.pipStep;
        this.#blit(ctx, pip, frame, x - pip.meta.ox, tries.pipY - pip.meta.oy);
      }
    }

    // The launch meter, dimmed while it is down.
    const meter = HUD.meter;
    const reading = meterReading(s, this.#zones);
    // Dimmed in the colours rather than by globalAlpha: a partial-alpha fill
    // is how a particle is told apart from the chrome.
    const dim = reading.up ? 1 : 0.4;
    ctx.globalAlpha = dim;
    label(this.#strings.launchLabel.toUpperCase(), meter.labelX);
    ctx.globalAlpha = 1;
    roundedPath(ctx, meter.x, meter.y, meter.w, meter.h, meter.radius);
    ctx.fillStyle = rgba(0x000000, 0.32 * dim);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const zone = (span: readonly [number, number] | null, colour: number, alpha: number): void => {
      if (span === null) return;
      const from = meter.x + meter.w * Math.min(...span);
      ctx.fillStyle = rgba(colour, alpha * dim);
      ctx.fillRect(from, meter.y, meter.w * Math.abs(span[1] - span[0]), meter.h);
    };
    zone(this.#zones.band, HUD_COLOURS.meterBand, 0.8);
    zone(this.#zones.sweet, HUD_COLOURS.meterSweet, 0.9);
    ctx.restore();
    if (reading.up) {
      const kx = meter.x + meter.w * reading.fraction;
      const ky = meter.y + meter.h / 2;
      if (reading.inBand) {
        ctx.beginPath();
        ctx.arc(kx, ky, meter.knob + 3, 0, Math.PI * 2);
        ctx.fillStyle = rgba(HUD_COLOURS.meterBand, 0.45);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(kx, ky + 1, meter.knob, 0, Math.PI * 2);
      ctx.fillStyle = SHADOW;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(kx, ky, meter.knob, 0, Math.PI * 2);
      ctx.fillStyle = hex(HUD_COLOURS.meterKnob);
      ctx.fill();
    }

    // This shot and the game so far.
    for (const field of panelFields(s, this.#strings)) {
      label(field.label, field.x);
      ctx.font = field.big ? FONTS.value : FONTS.sub;
      ctx.fillStyle = field.big ? HUD_COLOURS.ink : HUD_COLOURS.subInk;
      ctx.fillText(field.value, field.x, HUD.valueBaseline);
    }

    // Glide meter: its label over the track.
    const glide = HUD.glide;
    const fill = glideFill(s);
    label(this.#strings.glide.toUpperCase(), glide.labelX);
    roundedPath(ctx, glide.x, glide.y, glide.w, glide.h, glide.radius);
    ctx.fillStyle = TRACK;
    ctx.fill();
    const inner = glide.w - glide.inset * 2;
    const fillW = inner * fill.fraction;
    if (fillW > 0.5) {
      const fx = glide.x + glide.inset;
      const fy = glide.y + glide.inset;
      const fh = glide.h - glide.inset * 2;
      roundedPath(ctx, fx, fy, fillW, fh, fh / 2);
      ctx.fillStyle = hex(fill.colour);
      ctx.fill();
      if (fillW > 6) {
        roundedPath(ctx, fx + 2, fy + 1.5, fillW - 4, 3.5, 1.75);
        ctx.fillStyle = GLOSS;
        ctx.fill();
      }
    }

    this.#minimap(ctx, s);

    if (this.#showHitboxes) {
      const debug = HUD.debug;
      card(ctx, debug.x, debug.y, debug.w, debug.h, debug.radius);
      ctx.font = FONTS.debug;
      ctx.fillStyle = HUD_COLOURS.debugInk;
      for (const [i, line] of debugLines(s).entries()) {
        ctx.fillText(line, debug.textX, debug.baseline + i * debug.lineHeight);
      }
    }

    const prompt = promptFor(s, this.#touch, this.#strings);
    if (prompt !== null) {
      const box = HUD.prompt;
      ctx.font = FONTS.prompt;
      setSpacing(ctx, HUD_TYPE.prompt.letterSpacing);
      const width = ctx.measureText(prompt).width;
      const x = (C.VIEW_W - width) / 2 - box.pad;
      const w = width + box.pad * 2;
      roundedPath(ctx, x, box.y + box.shadowDy, w, box.h, box.h / 2);
      ctx.fillStyle = SHADOW;
      ctx.fill();
      card(ctx, x, box.y, w, box.h, box.h / 2, PROMPT_CHROME);
      ctx.fillStyle = HUD_COLOURS.promptInk;
      ctx.fillText(prompt, (C.VIEW_W - width) / 2, box.baseline);
    }
    ctx.restore();
  }

  #minimap(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    const map = minimapModel(s);
    if (map === null) return;
    const m = HUD.minimap;
    card(ctx, m.x, m.y, m.w, m.h, m.radius, rgba(HUD_COLOURS.chrome, HUD_COLOURS.mapAlpha));
    ctx.save();
    roundedPath(ctx, m.x + 2, m.y + 2, m.w - 4, m.h - 4, m.radius - 2);
    ctx.clip();
    if (map.groundY !== null) {
      ctx.fillStyle = rgba(HUD_COLOURS.mapGround, 0.55);
      ctx.fillRect(m.x, map.groundY, m.w, 1.5);
    }
    ctx.strokeStyle = rgba(HUD_COLOURS.mapView, HUD_COLOURS.mapViewAlpha);
    ctx.lineWidth = 1;
    ctx.strokeRect(map.view.x + 0.5, map.view.y + 0.5, map.view.w - 1, map.view.h - 1);
    for (const item of map.items) {
      ctx.beginPath();
      ctx.arc(item.x, item.y, m.dot, 0, Math.PI * 2);
      ctx.fillStyle = rgba(ITEM_COLOURS[item.kind], item.beyond ? HUD_COLOURS.mapBeyondAlpha : 1);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(map.hamster.x, map.hamster.y, m.dot + 0.8, 0, Math.PI * 2);
    ctx.fillStyle = hex(HUD_COLOURS.mapHamster);
    ctx.fill();
    ctx.strokeStyle = hex(HUD_COLOURS.chrome);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
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
