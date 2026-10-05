import { isBallPose, poseFor } from "@/render/scene/pose.ts";
import { metres } from "@/render/units.ts";
import { C } from "@/sim/constants.ts";
import { launchMeterValue } from "@/sim/phases/JumpPhase.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { DEFAULT_TUNING, type Tuning } from "@/sim/tuning.ts";
import type { PowerupKind } from "@/sim/types.ts";

/**
 * The HUD, as geometry and strings. Both renderers lay it out from here, so
 * the panel cannot sit at 122 px in one and 120 px in the other.
 */

/**
 * The port's typeface (`src/app/fonts.ts`), with the system stack behind it
 * for the moment before it loads or a browser that blocks it.
 */
const UI = '"Fredoka", system-ui, sans-serif';

export const HUD = {
  /**
   * One bar across the top for everything the player reads while playing:
   * the tries, the launch meter, the distances and the glide meter, in that
   * order, each a small capitalised label over its reading. The original put
   * the shot pips and the launch meter down the left edge as art of their
   * own; the bar draws the same state in the port's look.
   */
  bar: { x: 8, y: 8, w: 584, h: 44, radius: 12 },
  /** Hairlines between the bar's sections. */
  dividers: [104, 224, 426],
  labelBaseline: 21,
  valueBaseline: 42,
  /** The five `hud/shotPip`s, side by side under the try count. */
  tries: { labelX: 20, pipX: 20, pipStep: 15.5, pipY: 27 },
  /**
   * The launch meter, on its side: the hamster's height on the pad against
   * the band where a swing reaches the pillow.
   */
  meter: { labelX: 116, x: 116, y: 29, w: 96, h: 11, radius: 5.5, knob: 6 },
  /**
   * This shot and the game so far. Wide enough for "999.99 m" and
   * "9999.99 m" under German labels; `test/app/meta.spec.ts` holds it to that.
   */
  panel: { columns: [236, 330] },
  glide: {
    labelX: 438,
    /** The track. */
    x: 438,
    y: 27,
    w: 144,
    h: 15,
    radius: 7.5,
    /** The fill sits this far inside the track on every side. */
    inset: 2.5,
  },
  /**
   * The minimap, under the bar's right end while a hamster is in the air:
   * everything the simulation knows about - powerups exist from 100 px off
   * the left edge to 200 px past the right, at any height - squeezed into a
   * card, with the view and the hamster marked on it.
   */
  minimap: { x: 432, y: 58, w: 160, h: 74, radius: 10, pad: 6, dot: 2.6 },
  debug: {
    x: 10,
    y: C.VIEW_H - 58,
    w: 260,
    h: 48,
    radius: 8,
    textX: 18,
    baseline: C.VIEW_H - 42,
    lineHeight: 14,
  },
  // Clear of the corner buttons, which a narrow stage makes relatively large.
  prompt: { y: C.VIEW_H - 84, h: 32, pad: 16, baseline: C.VIEW_H - 62, shadowDy: 2 },
} as const;

export const HUD_COLOURS = {
  chrome: 0x0e1a28,
  chromeAlpha: 0.62,
  /** A hairline round every card, so it reads against a dark sky too. */
  rim: 0xffffff,
  rimAlpha: 0.16,
  /** A lit edge along the inside of a card's top, as if the chrome caught the light. */
  sheenAlpha: 0.14,
  promptAlpha: 0.7,
  shadow: 0x000000,
  shadowAlpha: 0.22,
  ink: "#ffffff",
  labelInk: "#b9d3e8",
  subInk: "#e3eef7",
  debugInk: "#9fe3ff",
  promptInk: "#ffffff",
  glideOk: 0xffb13b,
  /** The launch meter: its track, the band a swing hits in, the best of it. */
  meterBand: 0x6fd24a,
  meterSweet: 0xffe066,
  meterKnob: 0xffffff,
  divider: 0xffffff,
  dividerAlpha: 0.12,
  /** The minimap's hamster, view frame and ground. */
  mapHamster: 0xffffff,
  mapView: 0xffffff,
  mapViewAlpha: 0.4,
  mapGround: 0x6fd24a,
  /** More opaque than the other cards: the sky's stars must not read as items. */
  mapAlpha: 0.92,
  /** An item past the map's edge, pinned to it. */
  mapBeyondAlpha: 0.6,
  glideEmpty: 0xff6b6b,
  /** The top half of the glide fill, lighter: a glossy bar, in either colour. */
  gloss: 0xffffff,
  glossAlpha: 0.3,
  markerInk: "#ffffff",
  markerAlpha: 0.6,
  hitboxHamster: 0x4dd2ff,
  hitboxPowerup: 0xff4d6d,
} as const;

/** The type sizes, shared so Pixi's TextStyles and the canvas fonts agree. */
export const HUD_TYPE = {
  label: { size: 8.5, weight: "600", letterSpacing: 0.9 },
  value: { size: 18, weight: "600", letterSpacing: 0 },
  sub: { size: 14, weight: "600", letterSpacing: 0 },
  prompt: { size: 17, weight: "600", letterSpacing: 0.2 },
  marker: { size: 10, weight: "600", letterSpacing: 0.3 },
} as const;

export type HudType = (typeof HUD_TYPE)[keyof typeof HUD_TYPE];

/** A canvas `font` shorthand for one of `HUD_TYPE`. */
export function cssFont(type: HudType): string {
  return `${type.weight} ${type.size}px ${UI}`;
}

export const FONTS = {
  mono: "ui-monospace, monospace",
  /** The distance signs only: they stand in for the original's font 236. */
  sans: "system-ui, sans-serif",
  ui: UI,
  /** The debug readout stays monospaced - it is a developer's tool. */
  debug: "600 12px ui-monospace, monospace",
  label: cssFont(HUD_TYPE.label),
  value: cssFont(HUD_TYPE.value),
  sub: cssFont(HUD_TYPE.sub),
  marker: cssFont(HUD_TYPE.marker),
  prompt: cssFont(HUD_TYPE.prompt),
} as const;

/**
 * The stacked-ball count (`Tuning.stackBalls`, a port addition): `×N` beside
 * the ball once more than one is queued. World pixels from the hamster, upright
 * rather than turning with the clip, just outside both balls' rims - the pink
 * one is 41 px across the middle, the gold one 32.
 */
export const BALL_BADGE = {
  dx: 26,
  dy: -30,
  font: `700 13px ${FONTS.ui}`,
  size: 13,
  fill: "#ffffff",
  stroke: "#3a1830",
  strokeWidth: 3,
} as const;

/** The badge text for this snapshot, or null when there is nothing to count. */
export function ballBadge(s: SimSnapshot): string | null {
  if (s.phaseKind !== "flying" || s.balls.length < 2) return null;
  return isBallPose(poseFor(s)) ? `×${s.balls.length}` : null;
}

export function totalFeet(s: SimSnapshot): number {
  let total = 0;
  for (const feet of s.shots) total += feet;
  return total;
}

/**
 * Every word the canvas shows. English is the default and what the tests
 * read; the page hands a renderer another set through `RendererOptions`.
 * `tap` is whether the primary pointer is a finger.
 */
export interface HudStrings {
  /** The score card's three labels; shown in capitals. */
  readonly distanceLabel: string;
  readonly totalLabel: string;
  readonly triesLabel: string;
  readonly launchLabel: string;
  readonly glide: string;
  readonly paused: (tap: boolean) => string;
  readonly jump: (tap: boolean) => string;
  readonly missed: string;
  readonly getReady: string;
  readonly swing: (tap: boolean) => string;
  readonly hold: string;
  readonly total: (distance: string) => string;
  readonly playAgain: (distance: string, tap: boolean) => string;
  readonly ghost: string;
  readonly record: string;
}

export const EN_HUD: HudStrings = {
  distanceLabel: "distance",
  totalLabel: "total",
  triesLabel: "try",
  launchLabel: "launch",
  glide: "glide",
  paused: (tap) => (tap ? "paused - tap to resume" : "paused - click, Space or P to resume"),
  jump: (tap) => `${tap ? "tap" : "click"} to jump`,
  missed: "missed - wait for the landing",
  getReady: "get ready...",
  swing: (tap) => `${tap ? "tap" : "click"} again to hit the pillow`,
  hold: "hold to glide",
  total: (distance) => `${distance} total`,
  playAgain: (distance, tap) => `${distance} total - ${tap ? "tap" : "click"} to play again`,
  ghost: "ghost",
  record: "record",
};

export interface PanelField {
  /** Left edge of the column, stage pixels. */
  readonly x: number;
  readonly label: string;
  readonly value: string;
  /** This shot's distance is the headline; the total is set smaller. */
  readonly big: boolean;
}

/** The bar's distance section: this shot and the game so far. */
export function panelFields(
  s: SimSnapshot,
  t: HudStrings = EN_HUD,
): readonly [PanelField, PanelField] {
  const [a, b] = HUD.panel.columns;
  return [
    { x: a, label: t.distanceLabel.toUpperCase(), value: metres(s.feet), big: true },
    { x: b, label: t.totalLabel.toUpperCase(), value: metres(totalFeet(s)), big: false },
  ];
}

/** "TRY 2/5" over the pips. */
export function triesLabel(s: SimSnapshot, t: HudStrings = EN_HUD): string {
  return `${t.triesLabel.toUpperCase()} ${Math.min(s.turn, C.TURNS)}/${C.TURNS}`;
}

/**
 * The pip frames, `hud/shotPip` - frame 1 `off`, frame 2 `on`. `setScore()`
 * lights the pip for the turn that just finished, so the lit count is exactly
 * the number of shots on the board.
 */
export function pipFrames(s: SimSnapshot): readonly number[] {
  return Array.from({ length: C.TURNS }, (_, at) => (at < s.shots.length ? 1 : 0));
}

// -- the launch meter ------------------------------------------------------------

/**
 * Where along the meter a height on the pad sits, 0 to 1 - the original's
 * needle, `48 + 0.35417 * (y - 715)` clamped to 10..100 (`launchMeterValue`),
 * laid on its side. Left is high.
 */
export function meterFraction(y: number): number {
  return (launchMeterValue(y) - 10) / 90;
}

export interface LaunchZones {
  /** The band a swing connects in, as meter fractions; null if it cannot. */
  readonly band: readonly [number, number] | null;
  /**
   * The best of it: launch speed is `90 - dist` from the pillow's centre, and
   * below `PILLOW_CLAMP_Y` the rising bonus is lost, so the sweet part runs
   * from the centre down to the clamp.
   */
  readonly sweet: readonly [number, number] | null;
}

/**
 * The swing's reach, from the same boxes `attemptLaunch` tests: the jump
 * core against the whole pillow clip. The heights where they overlap are
 * y in [694.7, 776.4] for the extracted boxes (porting-notes).
 */
export function launchZones(tuning: Tuning = DEFAULT_TUNING): LaunchZones {
  const a = tuning.boxes.hamsterJumpCore;
  const b = tuning.boxes.pillow;
  const reachX = Math.abs(C.HAMSTER_X + a.cx - (C.PILLOW_LAUNCH_X + b.cx)) <= a.hw + b.hw;
  if (!reachX) return { band: null, sweet: null };
  const centre = C.PILLOW_Y + b.cy - a.cy;
  const reach = a.hh + b.hh;
  const band = [meterFraction(centre - reach), meterFraction(centre + reach)] as const;
  // dy = y - PILLOW_Y + LAUNCH_DY_BIAS is zero here: the fastest launch.
  const best = C.PILLOW_Y - C.LAUNCH_DY_BIAS;
  const sweet = [
    meterFraction(best),
    meterFraction(Math.min(C.PILLOW_CLAMP_Y, centre + reach)),
  ] as const;
  return { band, sweet };
}

export interface MeterBand {
  /** Left edge and width on the stage; the band spans the track's height. */
  readonly x: number;
  readonly w: number;
  readonly colour: number;
  readonly alpha: number;
}

/** The swing's reach and the best of it, as strips across the meter's track. */
export function meterBands(zones: LaunchZones): readonly MeterBand[] {
  const meter = HUD.meter;
  const bands: MeterBand[] = [];
  for (const [span, colour, alpha] of [
    [zones.band, HUD_COLOURS.meterBand, 0.8],
    [zones.sweet, HUD_COLOURS.meterSweet, 0.9],
  ] as const) {
    if (span === null) continue;
    const x = meter.x + meter.w * Math.min(...span);
    bands.push({ x, w: meter.w * Math.abs(span[1] - span[0]), colour, alpha });
  }
  return bands;
}

export interface MeterReading {
  /** Up for exactly the two phases before the hamster is away, as the original's. */
  readonly up: boolean;
  readonly fraction: number;
  /** A swing now would reach the pillow. */
  readonly inBand: boolean;
}

export function meterReading(s: SimSnapshot, zones: LaunchZones): MeterReading {
  const up = s.phaseKind === "ready" || s.phaseKind === "jumping";
  const fraction = meterFraction(s.hamster.y);
  const band = zones.band;
  // Clip 52 places its core on frame 28 only: during the wind-up nothing connects.
  const live = s.phaseKind === "jumping" && s.windup === null;
  const inBand =
    up && live && band !== null && fraction >= Math.min(...band) && fraction <= Math.max(...band);
  return { up, fraction, inBand };
}

// -- the minimap -----------------------------------------------------------------

/**
 * What the minimap covers, around the view: across, the simulation's own
 * window on the powerups (spawned 200 px past the right edge, culled 100 px
 * past the left); up and down, a view's height and a bit either side. A fixed
 * scale rather than a fit to the whole sky, so the view frame keeps its size
 * however high the hamster goes - an item beyond the edge is pinned to it,
 * faded, on the side it lies.
 */
export const MINIMAP_SPAN = {
  left: -100,
  right: C.VIEW_W + 200,
  above: 520,
  below: 480,
} as const;

export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

export interface MapItem extends MapPoint {
  readonly kind: PowerupKind;
  /** Further out than the map reaches; drawn at its edge. */
  readonly beyond: boolean;
}

export interface MinimapModel {
  /** The view, as a rectangle on the map. */
  readonly view: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Where the ground is, or null while it is off the map. */
  readonly groundY: number | null;
  readonly hamster: MapPoint;
  readonly items: readonly MapItem[];
}

/** The minimap in stage pixels, or null when there is no flight to map. */
export function minimapModel(s: SimSnapshot): MinimapModel | null {
  if (s.phaseKind !== "flying") return null;
  const m = HUD.minimap;
  const span = MINIMAP_SPAN;
  const left = m.x + m.pad;
  const top = m.y + m.pad;
  const innerW = m.w - m.pad * 2;
  const innerH = m.h - m.pad * 2;
  // Map coordinates run over screen coordinates: world + camera.
  const sx = innerW / (span.right - span.left);
  const sy = innerH / (span.above + C.VIEW_H + span.below);
  const rawX = (worldX: number): number => left + (worldX + s.camera.x - span.left) * sx;
  const rawY = (worldY: number): number => top + (worldY + s.camera.y + span.above) * sy;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const point = (x: number, y: number): MapPoint & { beyond: boolean } => {
    const px = rawX(x);
    const py = rawY(y);
    const cx = clamp(px, left, left + innerW);
    const cy = clamp(py, top, top + innerH);
    return { x: cx, y: cy, beyond: cx !== px || cy !== py };
  };
  const ground = rawY(C.GROUND_Y);
  const viewX = rawX(-s.camera.x);
  const viewY = rawY(-s.camera.y);
  const hamster = point(s.hamster.x, s.hamster.y);
  return {
    view: { x: viewX, y: viewY, w: C.VIEW_W * sx, h: C.VIEW_H * sy },
    groundY: ground >= top && ground <= top + innerH ? ground : null,
    hamster: { x: hamster.x, y: hamster.y },
    items: s.powerups.filter((p) => !p.taken).map((p) => ({ kind: p.kind, ...point(p.x, p.y) })),
  };
}

/** A colour per item, near its art's, so a dot says which one it is. */
export const ITEM_COLOURS = {
  speed: 0xff5a4e,
  slide: 0xff9f1c,
  wind: 0x9fdcff,
  bounce: 0xff7ad9,
  superbounce: 0xffd23f,
  rebound: 0xc98a4b,
} as const satisfies Record<PowerupKind, number>;

export interface GlideFill {
  /** 0 to 1 of the bar's width. */
  readonly fraction: number;
  readonly colour: number;
}

export function glideFill(s: SimSnapshot): GlideFill {
  const fraction = Math.min(1, Math.max(0, s.glidePoints / C.GLIDE_MAX));
  return { fraction, colour: s.glidePoints > 0 ? HUD_COLOURS.glideOk : HUD_COLOURS.glideEmpty };
}

export function debugLines(s: SimSnapshot): readonly [string, string, string] {
  const h = s.hamster;
  const active: string[] = [];
  for (const [name, on] of Object.entries(s.flags)) if (on) active.push(name);
  return [
    `x ${h.x.toFixed(1)}  y ${h.y.toFixed(1)}`,
    `xvel ${h.xvel.toFixed(2)}  yvel ${h.yvel.toFixed(2)}`,
    `t${s.tick} ${s.phaseKind} ${active.join(" ")}`,
  ];
}

/** What to tell the player, or null when the picture says it all. */
export function promptFor(s: SimSnapshot, touch = false, t: HudStrings = EN_HUD): string | null {
  // "Click" on a phone reads as a mouse-only game, and a phone has no P key.
  if (s.paused) return t.paused(touch);
  switch (s.phaseKind) {
    case "ready":
      // Nothing to click for while the next hamster is still walking out.
      return s.walkOut !== null ? null : t.jump(touch);
    case "jumping":
      // One swing per jump: after a whiff there is nothing left to click for,
      // and saying "click again" was an invitation to mash at a dead button.
      if (s.swung) return t.missed;
      // Nothing can connect before clip 52 lifts off, and the swing is spent
      // on the first click - so do not ask for one while it is still winding up.
      return s.windup !== null ? t.getReady : t.swing(touch);
    case "flying":
      return s.flags.skidding ? null : t.hold;
    case "gameOver":
      // Only once PLAY AGAIN is up: a click before that does nothing.
      return s.restartable
        ? t.playAgain(metres(totalFeet(s)), touch)
        : t.total(metres(totalFeet(s)));
    default:
      return null;
  }
}
