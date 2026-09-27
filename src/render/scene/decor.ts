import type { SpriteId } from "@/assets/sprites.generated.ts";
import { markerLabel, markerScale } from "@/render/units.ts";
import { C } from "@/sim/constants.ts";
import type { CameraState, SimSnapshot } from "@/sim/state.ts";
import type { PowerupKind } from "@/sim/types.ts";

/**
 * Everything both renderers decide identically about the scene, as pure
 * functions of the snapshot: which sprite, where, what colour. The backends
 * only differ in *how* they put pixels down, so this is where the picture is
 * defined once and the "kept in step with the other renderer" comments go away.
 * `PreLaunchScene` is the same idea for the launcher end of the world.
 */

export const POWERUP_SPRITE: Record<PowerupKind, SpriteId> = {
  bounce: "powerup/bounce",
  speed: "powerup/speed",
  wind: "powerup/wind",
  slide: "powerup/slide",
  rebound: "powerup/rebound",
  superbounce: "powerup/superbounce",
};

/** Indexed by the bush hash, so a renamed sprite is a compile error, not a blank. */
export const BUSHES = [
  "bush/1",
  "bush/2",
  "bush/3",
  "bush/4",
  "bush/5",
] as const satisfies readonly SpriteId[];

/** Decoration counts at stress 1. Both renderers use these, so they compare. */
export const STAR_COUNT = 70;
export const BUSH_SPACING = 260;
/** Enough bubble to still read as one, little enough to see the hamster. */
export const BUBBLE_ALPHA = 0.62;
export const SHADOW_ALPHA = 0.45;

/** The ground: two slabs the width of the whole course. */
export const GROUND = {
  x: -2000,
  width: 400_000,
  height: 600,
  lip: 5,
  colour: 0x5d9b47,
  lipColour: 0x4b7f38,
} as const;

export type Rgb = readonly [number, number, number];

/** The sky at ground level and in space, top and bottom of the gradient. */
const SKY_TOP_DAY: Rgb = [116, 182, 226];
const SKY_TOP_SPACE: Rgb = [12, 16, 40];
const SKY_BOTTOM_DAY: Rgb = [176, 216, 240];
const SKY_BOTTOM_SPACE: Rgb = [30, 40, 78];
/** Stars fade in above this altitude fraction and are full a bit later. */
const STARS_FROM = 0.35;
const STARS_SPAN = 0.4;

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function rgbCss([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export function rgbInt([r, g, b]: Rgb): number {
  return (r << 16) | (g << 8) | b;
}

/** 0 on the ground, 1 at the space backdrop. Space is reachable. */
export function altitudeOf(s: SimSnapshot): number {
  return clamp((C.GROUND_Y - s.hamster.y) / Math.abs(C.SPACE_BG_Y), 0, 1);
}

export interface Sky {
  readonly top: Rgb;
  readonly bottom: Rgb;
  /** 0 hides the star field entirely. */
  readonly starAlpha: number;
}

/** The higher the hamster, the darker the sky. */
export function skyColours(altitude: number): Sky {
  return {
    top: mix(SKY_TOP_SPACE, SKY_TOP_DAY, 1 - altitude),
    bottom: mix(SKY_BOTTOM_SPACE, SKY_BOTTOM_DAY, 1 - altitude),
    starAlpha: altitude > STARS_FROM ? clamp((altitude - STARS_FROM) / STARS_SPAN, 0, 1) : 0,
  };
}

/**
 * The star field's depth layers, far to near. Each drifts against the camera
 * at its own fraction of the camera's speed, so up among the stars - where
 * there is no ground, no bush and rarely a powerup to measure speed against -
 * the sky itself still shows which way and how fast the hamster is going, and
 * the layers sliding past each other read as depth. The nearer, the bigger.
 */
export const STAR_LAYERS = [
  { parallax: 0.02, size: 0.8 },
  { parallax: 0.06, size: 1 },
  { parallax: 0.14, size: 1.35 },
] as const;

export interface Star {
  /** Within the 600 x 400 tile the layer repeats on. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** Index into `STAR_LAYERS`. */
  readonly layer: number;
}

/** Deterministic from a cheap hash, so the field is stable without state. */
export function starField(stress: number): readonly Star[] {
  const out: Star[] = [];
  for (let i = 0; i < STAR_COUNT * stress; i++) {
    const h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
    const layer = i % STAR_LAYERS.length;
    out.push({
      x: ((h % 1000) / 1000) * C.VIEW_W,
      y: (((h >>> 10) % 1000) / 1000) * C.VIEW_H,
      r: (0.6 + ((h >>> 20) % 3) * 0.35) * (STAR_LAYERS[layer]?.size ?? 1),
      layer,
    });
  }
  return out;
}

/** `value` mod `span`, always in [0, span). */
export function wrap(value: number, span: number): number {
  const r = value % span;
  return r < 0 ? r + span : r;
}

/**
 * Where a star layer's tile starts on screen, in [0, VIEW_W) x [0, VIEW_H).
 * The camera offsets are the world's own translation, so the layer moves the
 * same way the world does, only slower: left as the hamster flies right, down
 * as it climbs.
 */
export function starOffset(camera: CameraState, parallax: number): { x: number; y: number } {
  return { x: wrap(camera.x * parallax, C.VIEW_W), y: wrap(camera.y * parallax, C.VIEW_H) };
}

/** A star's position on screen, with its layer drifted by the camera. */
export function starAt(star: Star, camera: CameraState): { x: number; y: number } {
  const off = starOffset(camera, STAR_LAYERS[star.layer]?.parallax ?? 0);
  return { x: wrap(star.x + off.x, C.VIEW_W), y: wrap(star.y + off.y, C.VIEW_H) };
}

/** A puff: centre offset from the cloud's anchor, and radius, in cloud pixels. */
export type Puff = readonly [dx: number, dy: number, r: number];

export interface CloudShape {
  /** The flat underside, left end and width, sitting on the anchor line. */
  readonly base: readonly [x: number, width: number];
  readonly puffs: readonly Puff[];
}

/**
 * Three cloud outlines, drawn rather than taken from the atlas: the original's
 * cloud clips are painted for its sunset backdrop, and gold and orange against
 * this port's blue sky read as something other than weather. The anchor is the
 * middle of the flat underside.
 */
export const CLOUD_SHAPES: readonly CloudShape[] = [
  {
    base: [-58, 116],
    puffs: [
      [-40, -8, 16],
      [-16, -20, 24],
      [14, -24, 28],
      [42, -12, 18],
    ],
  },
  {
    base: [-40, 80],
    puffs: [
      [-22, -10, 16],
      [2, -20, 22],
      [26, -10, 15],
    ],
  },
  {
    base: [-76, 152],
    puffs: [
      [-58, -8, 15],
      [-34, -18, 22],
      [-4, -26, 28],
      [28, -18, 22],
      [56, -8, 16],
    ],
  },
];

/** Radius of the flat underside's rounded ends, and how far the shaded rim drops below. */
export const CLOUD_BASE_H = 14;
export const CLOUD_SHADE_DROP = 4;

/** The lit tops and the shaded underside, before the fade into the sky. */
export const CLOUD_WHITE: Rgb = [255, 255, 255];
export const CLOUD_SHADE: Rgb = [214, 228, 242];

/**
 * The cloud layer: one plane behind the world, drifting at `parallax` of the
 * camera's speed. It covers the blue part of the climb - the stretch between
 * the bushes and the stars where the sky was a bare gradient - and scrolls out
 * of view as the hamster climbs into the stars, where `STAR_LAYERS` take over.
 * Layer units are screen pixels at the camera's rest position; `top` and
 * `bottom` bound the band, a cloud per cell with probability `share`.
 */
export const CLOUD_LAYER = {
  parallax: 0.45,
  cellW: 240,
  cellH: 150,
  top: -1500,
  bottom: 150,
  share: 0.35,
} as const;

export interface CloudPlacement {
  /** Index into `CLOUD_SHAPES`. */
  readonly shape: number;
  /** Screen position of the anchor. */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/**
 * The clouds on screen, drawn from a stable hash of their cell so no state is
 * needed. `stress` packs the cells tighter, as it does the bushes.
 */
export function clouds(camera: CameraState, stress: number): readonly CloudPlacement[] {
  const layer = CLOUD_LAYER;
  const cellW = layer.cellW / Math.max(1, stress);
  // The layer's own offset: how far it has slid since the camera's rest.
  const dx = camera.x * layer.parallax;
  const dy = (camera.y - C.CAM_Y_CLAMP) * layer.parallax;
  const out: CloudPlacement[] = [];
  // Margins for the widest cloud (about 160 px scaled up) and the jitter.
  const firstCol = Math.floor((-dx - 220) / cellW);
  const lastCol = Math.floor((-dx + C.VIEW_W + 100) / cellW);
  const firstRow = Math.max(
    Math.floor((-dy - 100) / layer.cellH),
    Math.floor(layer.top / layer.cellH),
  );
  const lastRow = Math.min(
    Math.floor((-dy + C.VIEW_H + 60) / layer.cellH),
    Math.floor(layer.bottom / layer.cellH),
  );
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const h =
        Math.imul(Math.imul(col, 0x27d4eb2f) ^ Math.imul(row + 7, 0x165667b1), 0x9e3779b1) >>> 0;
      if ((h % 1000) / 1000 >= layer.share) continue;
      out.push({
        shape: (h >>> 10) % CLOUD_SHAPES.length,
        x: col * cellW + (((h >>> 12) % 1000) / 1000) * cellW * 0.8 + dx,
        y: row * layer.cellH + (((h >>> 22) % 100) / 100) * layer.cellH * 0.6 + dy,
        scale: 0.7 + ((h >>> 5) % 50) / 100,
      });
    }
  }
  return out;
}

/**
 * A cloud's two colours at screen height `y`, faded towards the sky behind it.
 * Fading the colour rather than the alpha keeps the puffs opaque, so where they
 * overlap they do not double up into darker seams. The shade is the lit colour
 * multiplied by `CLOUD_SHADE`, which is exactly what a tint does to shade baked
 * into WebGL geometry - so both renderers land on the same pixels.
 */
export function cloudColours(sky: Sky, y: number): { lit: Rgb; shade: Rgb } {
  const behind = mix(sky.top, sky.bottom, clamp(y / C.VIEW_H, 0, 1));
  const lit = mix(behind, CLOUD_WHITE, cloudAlpha(sky));
  const shade: Rgb = [
    Math.round((lit[0] * CLOUD_SHADE[0]) / 255),
    Math.round((lit[1] * CLOUD_SHADE[1]) / 255),
    Math.round((lit[2] * CLOUD_SHADE[2]) / 255),
  ];
  return { lit, shade };
}

/** Clouds give way to the night: gone once the stars are fully out. */
export function cloudAlpha(sky: Sky): number {
  return 1 - sky.starAlpha;
}

export interface BushPlacement {
  readonly sprite: SpriteId;
  readonly x: number;
  readonly y: number;
}

/**
 * Bushes along the visible ground, drawn from a stable hash of their slot so
 * no state is needed. The hash takes the rounded slot: under `stress` the
 * spacing is fractional, and `Math.imul` truncating a fractional x collapsed
 * neighbouring slots onto the same bush.
 */
export function bushes(cameraX: number, stress: number): readonly BushPlacement[] {
  const out: BushPlacement[] = [];
  const spacing = BUSH_SPACING / stress;
  const from = Math.floor((-cameraX - 200) / spacing) * spacing;
  const until = -cameraX + C.VIEW_W + 200;
  for (let x = from; x < until; x += spacing) {
    const h = Math.imul(Math.round(x) + 7919, 0x85ebca6b) >>> 0;
    out.push({ sprite: BUSHES[h % BUSHES.length] ?? BUSHES[0], x: x + (h % 90), y: C.GROUND_Y });
  }
  return out;
}

export interface Markers {
  /** World x of each tick. */
  readonly ticks: readonly number[];
  readonly labels: readonly { readonly x: number; readonly text: string }[];
}

/** Distance markers along the ground, so progress is readable without the HUD. */
export function markers(cameraX: number): Markers {
  const scale = markerScale(C.PX_PER_FOOT);
  const every = scale.step * scale.labelEvery;
  const first = Math.max(0, Math.floor((-cameraX - 100) / scale.pixels / scale.step) * scale.step);
  const until = -cameraX + C.VIEW_W + 100;
  const ticks: number[] = [];
  const labels: { x: number; text: string }[] = [];
  for (let at = first; at * scale.pixels < until; at += scale.step) {
    const x = at * scale.pixels;
    ticks.push(x);
    // No label at the origin: it says nothing, and it sat on the tower's leg.
    if (at !== 0 && at % every === 0) labels.push({ x, text: markerLabel(at) });
  }
  return { ticks, labels };
}

/**
 * Powerup clips are attached and left standing on their first frame;
 * `_loc3_.play()` at the moment of pickup is what runs the rest
 * (Game.as:701, 716, 727, 750, 768). Only the first two frames are the
 * collectible: `powerup/bounce`, `powerup/slide` and `powerup/superbounce` are
 * two frames of item, four of burst and then twenty completely blank ones, and
 * `powerup/speed` two, four and two. Indexing them off a free-running clock
 * therefore blinked every collectible out for most of a 1.4 s cycle.
 *
 * The burst is not played: the simulation culls an item on the tick it is
 * taken, so there is nothing left to animate. Restoring it means giving it a
 * lifetime in the renderer, the way the `fx/*` impacts have one.
 */
export const POWERUP_IDLE_FRAME = 0;

/**
 * The shadow scales linearly with height: `100 * (y - 700) / 263`. Above
 * y = 700 the factor goes negative, which Flash renders as a flip - invisible
 * on a symmetric ellipse, so it is clamped to zero here. Bullet.as:54-56.
 */
export function shadowScale(y: number): number {
  return Math.max(0, (y - C.SHADOW_REF_Y) / C.SHADOW_DIV);
}

/** Below this the shadow is too small to see and not worth a draw. */
export const SHADOW_MIN_SCALE = 0.02;
