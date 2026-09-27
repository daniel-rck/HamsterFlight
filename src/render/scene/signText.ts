import type { SpriteId } from "@/assets/sprites.generated.ts";
import { FONTS } from "@/render/scene/hud.ts";
import type { Affine } from "@/render/scene/pose.ts";
import { metres } from "@/render/units.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/**
 * The distance on the sign the hamster holds up.
 *
 * `hit_cheer` (351) and `hit_hole` (365) place two text fields on their frame
 * 27 - `distance1_txt` under `distance_txt`, a pixel apart - and that frame's
 * script fills both with `distances[l - 1] + " ft."`
 * (as2/timeline/DefineSprite_351_hit_cheer/frame_27, and the same in 365).
 * Neither field is removed again, so the number stays up to frame 50. The
 * faceplant clip carries no sign; the cheer it hands over to does.
 *
 * Everything below is read off the SWF: the placements from
 * display-lists.txt (sprite 351 f27, sprite 365 f27), the fields from their
 * DefineEditText tags (345/346 and 363/364, identical pairs: 39.4 x 21.5 px
 * bounds from (-2, -2), centred, 14 px, font 236) and the widths from font
 * 236's DefineFont3 advance table.
 *
 * The one interpretation is the face. Font 236 is `FontOnAStick`, embedded as
 * outlines, and the page's CSP has no `font-src` - so the text is set in the
 * system sans and squeezed to the width the original glyphs take, which keeps
 * it centred on the board and inside the field. The sign says metres, like
 * every other length in the port - a choice the original never had to make.
 */

/** 0-based: the fields go up on frame 27. */
export const SIGN_FROM_FRAME = 26;

export interface SignField {
  /** The field's placement in the outcome clip, Flash's `[a, b, c, d, tx, ty]`. */
  readonly matrix: Affine;
  readonly colour: number;
}

/** `distance1_txt` (black, depth below) and `distance_txt` (yellow, on top). */
const SIGNS: Partial<Record<SpriteId, readonly SignField[]>> = {
  "hit/cheer": [
    { matrix: [-0.153168, -0.987686, 0.987686, -0.153168, -1.7, 18.85], colour: 0x000000 },
    { matrix: [-0.153168, -0.987686, 0.987686, -0.153168, -2.7, 18.15], colour: 0xffff33 },
  ],
  "hit/hole": [
    { matrix: [0.361206, -0.931946, 0.931946, 0.361206, -26.25, -2.4], colour: 0x000000 },
    { matrix: [0.361206, -0.931946, 0.931946, 0.361206, -26.8, -3.5], colour: 0xffff33 },
  ],
};

/**
 * Field-local geometry. The bounds run from -2 to 37.4 across and Flash keeps
 * a 2 px gutter inside them, so the text area is 35.4 px wide and centred on
 * 17.7; the first baseline sits the font's ascent (13.62 px at 14 px) below
 * the gutter.
 */
export const SIGN_TEXT = {
  centreX: 17.7,
  width: 35.4,
  baseline: 13.62,
  size: 14,
  font: `bold 14px ${FONTS.sans}`,
} as const;

/** Font 236's advances at 14 px, for the characters a distance can use. */
const ADVANCE: Readonly<Record<string, number>> = {
  "0": 5.46,
  "1": 2.87,
  "2": 5.46,
  "3": 6.12,
  "4": 5.89,
  "5": 6.12,
  "6": 5.46,
  "7": 6.77,
  "8": 5.69,
  "9": 5.25,
  " ": 3.36,
  f: 5.26,
  m: 9.01,
  t: 4.36,
  ".": 1.74,
};

/** The fields this pose's clip carries; empty for every clip without a sign. */
export function signFields(pose: SpriteId): readonly SignField[] {
  return SIGNS[pose] ?? [];
}

/** What the sign says on this frame of its clip, or null while it is blank. */
export function signText(s: SimSnapshot, pose: SpriteId, frame: number): string | null {
  if (s.phaseKind !== "settling" || frame < SIGN_FROM_FRAME) return null;
  if (signFields(pose).length === 0) return null;
  const feet = s.shots[s.shots.length - 1];
  if (feet === undefined) return null;
  return metres(feet);
}

/** How wide the original's glyphs set `text`, in field pixels. */
export function signWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ADVANCE[ch] ?? SIGN_TEXT.size / 2;
  return width;
}

/**
 * The horizontal squeeze that sets `text` at the original's width - and no
 * wider than the text area. Feet never need the cap ("9999 ft." is 35.72 px);
 * three-digit metres ("304.80 m", 42.72 px) would run off the field.
 */
export function signScaleX(text: string, measured: number): number {
  return measured > 0 ? Math.min(signWidth(text), SIGN_TEXT.width) / measured : 1;
}
