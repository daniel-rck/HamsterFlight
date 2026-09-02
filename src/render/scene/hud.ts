import { distance } from "@/render/units.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/**
 * The HUD, as geometry and strings. Both renderers lay it out from here, so
 * the panel cannot sit at 122 px in one and 120 px in the other.
 */

export const HUD = {
  /** Shifted right of x = 118: the shot pips and the launch meter keep the
   *  left column the original reserved for them. */
  panel: { x: 122, y: 10, w: 150, h: 16 * 2 + 10, textX: 130, baseline: 28, lineHeight: 16 },
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

export function totalFeet(s: SimSnapshot): number {
  let total = 0;
  for (const feet of s.shots) total += feet;
  return total;
}

export function panelLines(s: SimSnapshot, metric: boolean): readonly [string, string] {
  return [
    `try ${Math.min(s.turn, C.TURNS)}/${C.TURNS}`,
    `${distance(s.feet, metric)}   total ${distance(totalFeet(s), metric)}`,
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
export function promptFor(s: SimSnapshot, metric: boolean): string | null {
  if (s.paused) return "paused - P to resume";
  switch (s.phaseKind) {
    case "ready":
      return "click to jump";
    case "jumping":
      return "click again to hit the pillow";
    case "flying":
      return s.flags.skidding ? null : "hold to glide";
    case "gameOver":
      return `${distance(totalFeet(s), metric)} total - click to play again`;
    default:
      return null;
  }
}
