import { isBallPose, poseFor } from "@/render/scene/pose.ts";
import { metres } from "@/render/units.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";

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
   * The score card: three columns - this shot, the game so far, the try -
   * each a small capitalised label over its value. Shifted right of x = 118:
   * the shot pips and the launch meter keep the left column the original
   * reserved for them. Wide enough for "999.99 m", "9999.99 m" and "5/5"
   * under German labels; `test/app/meta.spec.ts` holds it to that.
   */
  panel: {
    x: 122,
    y: 8,
    w: 244,
    h: 44,
    radius: 10,
    columns: [132, 222, 312],
    labelBaseline: 21,
    valueBaseline: 42,
  },
  /**
   * The glide meter: a card of its own, the same height as the score card,
   * with its label where the score card has its labels - over the sky the
   * label alone was unreadable.
   */
  glide: {
    card: { x: 432, y: 8, w: 160, h: 44, radius: 10 },
    labelX: 442,
    labelBaseline: 21,
    /** The track. */
    x: 442,
    y: 27,
    w: 140,
    h: 15,
    radius: 7.5,
    /** The fill sits this far inside the track on every side. */
    inset: 2.5,
  },
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
  prompt: { y: C.VIEW_H - 64, h: 32, pad: 16, baseline: C.VIEW_H - 42, shadowDy: 2 },
} as const;

export const HUD_COLOURS = {
  chrome: 0x0e1a28,
  chromeAlpha: 0.62,
  /** A hairline round every card, so it reads against a dark sky too. */
  rim: 0xffffff,
  rimAlpha: 0.16,
  promptAlpha: 0.7,
  shadow: 0x000000,
  shadowAlpha: 0.22,
  ink: "#ffffff",
  labelInk: "#b9d3e8",
  subInk: "#e3eef7",
  debugInk: "#9fe3ff",
  promptInk: "#ffffff",
  glideOk: 0xffb13b,
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
  /** This shot's distance is the headline; the other two are set smaller. */
  readonly big: boolean;
}

/** The score card: this shot, the game so far, and which try it is. */
export function panelFields(
  s: SimSnapshot,
  t: HudStrings = EN_HUD,
): readonly [PanelField, PanelField, PanelField] {
  const [a, b, c] = HUD.panel.columns;
  return [
    { x: a, label: t.distanceLabel.toUpperCase(), value: metres(s.feet), big: true },
    { x: b, label: t.totalLabel.toUpperCase(), value: metres(totalFeet(s)), big: false },
    {
      x: c,
      label: t.triesLabel.toUpperCase(),
      value: `${Math.min(s.turn, C.TURNS)}/${C.TURNS}`,
      big: false,
    },
  ];
}

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
