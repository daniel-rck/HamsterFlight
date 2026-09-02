import type { SpriteId } from '@/assets/sprites.generated.ts';
import { C } from '@/sim/constants.ts';
import type { SimSnapshot } from '@/sim/state.ts';

/**
 * Which hamster clip the original would have made visible, and how it is
 * turned. Shared by both renderers so the two cannot drift - this used to be
 * two copies "kept in step" by hand.
 */

/** The pose for this snapshot, in the original's visibility precedence. */
export function poseFor(s: SimSnapshot): SpriteId {
  if (s.phaseKind === 'jumping' || s.phaseKind === 'ready') return 'hamster/jump';
  if (s.phaseKind === 'settling') {
    switch (s.outcome) {
      case 'hole':
        return 'hit/hole';
      case 'cheer':
        return 'hit/cheer';
      case 'zero':
        return 'hit/zero';
      default:
        return 'hit/faceplant';
    }
  }
  const f = s.flags;
  if (f.slide && f.skidding) return 'hamster/slide';
  if (f.skidding) return 'hamster/skid';
  if (f.bounce || f.superbounce) return 'hamster/ball';
  if (f.falling) return 'hamster/drop';
  if (f.glide) return 'hamster/glide';
  if (f.speed) return 'hamster/blur';
  if (f.wind) return 'hamster/wind';
  return 'hamster/fly';
}

/**
 * `Bullet.update()` - Bullet.as:42-47. The clip turns to face its velocity,
 * except while crawling along the ground (`xvel < 7 && y > 940` - the signed
 * xvel, as written) or when a skid has switched rotation off. The original
 * adds 90 because its art is authored pointing up; the exported poses face
 * right, so the sprite aligns with the velocity directly.
 */
export function hamsterRotation(s: SimSnapshot): number {
  if (s.phaseKind !== 'flying') return 0;
  const h = s.hamster;
  if (!h.doRotation) return 0;
  if (h.xvel < C.NO_ROTATE_XVEL && h.y > C.NO_ROTATE_Y) return 0;
  return Math.atan2(h.yvel, h.xvel);
}
