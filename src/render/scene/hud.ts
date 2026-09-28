import { isBallPose, poseFor } from "@/render/scene/pose.ts";
import { metres } from "@/render/units.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/**
 * The HUD, as geometry and strings. Both renderers lay it out from here, so
 * the panel cannot sit at 122 px in one and 120 px in the other.
 */

export const HUD = {
  /** Shifted right of x = 118: the shot pips and the launch meter keep the
   *  left column the original reserved for them. */
  // Wide enough for "999.99 m   total 9999.99 m" in the 12 px mono.
  panel: { x: 122, y: 10, w: 212, h: 16 * 2 + 10, textX: 130, baseline: 28, lineHeight: 16 },
  glide: {
    w: 110,
    x: C.VIEW_W - 110 - 14,
    y: 10,
    h: 18,
    fillY: 12,
    fillH: 14,
    labelBaseline: 24,
    labelGap: 8,
  },
  debug: {
    x: 10,
    y: C.VIEW_H - 58,
    w: 260,
    h: 48,
    textX: 18,
    baseline: C.VIEW_H - 42,
    lineHeight: 14,
  },
  prompt: { y: C.VIEW_H - 64, h: 32, pad: 14, baseline: C.VIEW_H - 42 },
} as const;

export const HUD_COLOURS = {
  chrome: 0x0c141e,
  chromeAlpha: 0.55,
  promptAlpha: 0.62,
  ink: "#eaf6ff",
  debugInk: "#9fe3ff",
  promptInk: "#ffffff",
  glideOk: 0xffd166,
  glideEmpty: 0xff6b6b,
  markerInk: "#ffffff",
  markerAlpha: 0.5,
  hitboxHamster: 0x4dd2ff,
  hitboxPowerup: 0xff4d6d,
} as const;

export const FONTS = {
  mono: "ui-monospace, monospace",
  sans: "system-ui, sans-serif",
  /** `600 12px mono` - the panel, the glide label, the debug readout. */
  hud: "600 12px ui-monospace, monospace",
  marker: "10px ui-monospace, monospace",
  prompt: "bold 17px system-ui, sans-serif",
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
  font: `bold 13px ${FONTS.sans}`,
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
  readonly tries: (turn: number, of: number) => string;
  readonly totalLabel: string;
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
  tries: (turn, of) => `try ${turn}/${of}`,
  totalLabel: "total",
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

export function panelLines(s: SimSnapshot, t: HudStrings = EN_HUD): readonly [string, string] {
  return [
    t.tries(Math.min(s.turn, C.TURNS), C.TURNS),
    `${metres(s.feet)}   ${t.totalLabel} ${metres(totalFeet(s))}`,
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
