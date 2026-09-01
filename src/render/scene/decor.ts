import type { SpriteId, SpriteMeta } from '@/assets/sprites.generated.ts';
import { launched } from '@/render/PreLaunchScene.ts';
import { markerScale } from '@/render/units.ts';
import { C } from '@/sim/constants.ts';
import type { Phase, SimSnapshot } from '@/sim/state.ts';
import type { PowerupKind } from '@/sim/types.ts';

/**
 * Everything both renderers decide identically about the scene, as pure
 * functions of the snapshot: which sprite, where, what colour. The backends
 * only differ in *how* they put pixels down, so this is where the picture is
 * defined once and the "kept in step with the other renderer" comments go away.
 * `PreLaunchScene` is the same idea for the launcher end of the world.
 */

export const POWERUP_SPRITE: Record<PowerupKind, SpriteId> = {
  bounce: 'powerup/bounce',
  speed: 'powerup/speed',
  wind: 'powerup/wind',
  slide: 'powerup/slide',
  rebound: 'powerup/rebound',
  superbounce: 'powerup/superbounce',
};

/** Indexed by the bush hash, so a renamed sprite is a compile error, not a blank. */
export const BUSHES = [
  'bush/1',
  'bush/2',
  'bush/3',
  'bush/4',
  'bush/5',
] as const satisfies readonly SpriteId[];

/** Sprite frames advance on real time at the original stage rate. */
export const SPRITE_FPS = 19;
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

export interface Star {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** Deterministic from a cheap hash, so the field is stable without state. */
export function starField(stress: number): readonly Star[] {
  const out: Star[] = [];
  for (let i = 0; i < STAR_COUNT * stress; i++) {
    const h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
    out.push({
      x: ((h % 1000) / 1000) * C.VIEW_W,
      y: (((h >>> 10) % 1000) / 1000) * C.VIEW_H,
      r: 0.6 + ((h >>> 20) % 3) * 0.35,
    });
  }
  return out;
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
export function markers(cameraX: number, metric: boolean): Markers {
  const scale = markerScale(C.PX_PER_FOOT, metric);
  const every = scale.step * scale.labelEvery;
  const first = Math.max(0, Math.floor((-cameraX - 100) / scale.pixels / scale.step) * scale.step);
  const until = -cameraX + C.VIEW_W + 100;
  const ticks: number[] = [];
  const labels: { x: number; text: string }[] = [];
  for (let at = first; at * scale.pixels < until; at += scale.step) {
    const x = at * scale.pixels;
    ticks.push(x);
    if (at % every === 0) labels.push({ x, text: `${at}${scale.suffix}` });
  }
  return { ticks, labels };
}

/** Which frame of a looping clip is showing after `elapsedMs` of real time. */
export function animFrame(meta: Pick<SpriteMeta, 'frames' | 'fps'>, elapsedMs: number): number {
  if (meta.frames <= 1) return 0;
  return Math.floor((elapsedMs / 1000) * (meta.fps ?? SPRITE_FPS)) % meta.frames;
}

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

/**
 * `launch()` runs on the *second* click, so the pillow holds its rest position
 * through the whole jump. Game.as:1029-1036, 1118-1121.
 */
export function pillowX(phase: Phase['kind']): number {
  return launched(phase) ? C.PILLOW_LAUNCH_X : C.PILLOW_REST_X;
}
