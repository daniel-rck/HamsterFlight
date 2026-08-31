// GENERATED FILE - do not edit by hand.
//
// Produced by reference/tools/extract_hitboxes.py from the original SWF
// (CWS v8, sha256:86b4de0d112e057d73465d337513750a2c114d226a946e9f5f7dff7b50c558b6).
// Regenerate with:
//   python3 reference/tools/extract_hitboxes.py <file.swf> \
//     > src/sim/hitboxes.generated.ts
//
// These close gap 13.1 of the reverse-engineering document: Flash hitTest is
// an AABB test, and these are the real bounds of the `core` subclips, resolved
// through the PlaceObject2 matrices with scale applied. Values are pixels in
// the owning clip's local space; `cx`/`cy` offset the box centre from the
// clip's registration point.

import type { Box } from './math/aabb.ts';

export const HITBOXES = {
  /** hamster.core during the jump phase; DefineSprite 52 -> char 45 */
  hamsterJumpCore: { hw: 13.7333, hh: 13.7333, cx: 1.0749, cy: 5.3249 },
  /** the arrow/flight clip's core; DefineSprite 331 -> char 205 */
  hamsterFlightCore: { hw: 19.8999, hh: 32.4999, cx: 0.9999, cy: 1.2499 },
  /** _bounce; DefineSprite 454 -> char 45 */
  powerupBounce: { hw: 13.3335, hh: 13.3335, cx: 6.9502, cy: 6.7502 },
  /** _rebound; DefineSprite 462 -> char 45 */
  powerupRebound: { hw: 8.3025, hh: 8.3025, cx: 0.4336, cy: 2.4336 },
  /** _slide; DefineSprite 463 -> char 45 */
  powerupSlide: { hw: 8.0, hh: 8.0, cx: 7.5, cy: 7.5 },
  /** _speed; DefineSprite 465 -> char 45 */
  powerupSpeed: { hw: 8.0, hh: 8.0, cx: 7.5, cy: 7.5 },
  /** _superbounce; DefineSprite 466 -> char 45 */
  powerupSuperbounce: { hw: 13.3335, hh: 13.3335, cx: 6.9502, cy: 6.7502 },
  /** _wind; DefineSprite 467 -> char 391 */
  powerupWind: { hw: 18.0592, hh: 29.9978, cx: 7.2592, cy: 2.4978 },
  /** whole clip bounds; char 234 */
  pillow: { hw: 21.5, hh: 27.1, cx: 0.0, cy: 0.0 },
} as const satisfies Record<string, Box>;

export type HitboxId = keyof typeof HITBOXES;
