import { C } from '../constants.ts';
import type { SimEvent } from '../events.ts';
import { radToDeg } from '../math/angles.ts';
import type { FlightState } from '../state.ts';
import { clearFalling } from './PowerupPickups.ts';

/**
 * `Game.checkCollision()` - Game.as:775-904.
 *
 * Two properties of this function are load-bearing:
 *
 *  1. It runs at step 3 of the tick, *before* `yvel += grav` at step 6, so the
 *     prediction `y + yvel` uses the previous tick's velocity. `sim.js` applies
 *     gravity first and therefore bounces a whole gravity step early.
 *
 *  2. The impact angle comes from `ox`/`oy`, which `Projectile.integrate()`
 *     captured before the last move. The vertical delta therefore spans two
 *     ticks (`yvel_prev + yvel_now`) while the horizontal delta spans one, so
 *     the computed angle is far steeper than `atan2(yvel, xvel)` and the 70
 *     degree faceplant threshold trips at a shallower real descent.
 *
 * The branch order below is the original's, cascade and all - an armed bounce
 * beats a steep impact, which is why the angle test cannot simply be hoisted.
 *
 * The impact clips are placed at the hamster's world x. The original pins them
 * to screen x instead (`155 - camX`, `165 - camX`; Game.as:812, 831, 853),
 * which is the same point while the camera is following at its 150 px anchor
 * and differs only left of x = 150, where the camera has not started moving.
 */
export function resolveGround(s: FlightState, out: SimEvent[]): void {
  const p = s.p;
  const predictedY = p.y + p.yvel;

  // A rebound pickup suppresses ground handling entirely for the tick.
  if (s.flags.rebound) return;
  if (predictedY < C.GROUND_Y) return;

  p.y = C.GROUND_Y;
  p.hit = true;

  if (s.flags.glide) {
    s.flags.glide = false;
    out.push({ t: 'glide', on: false });
  }

  const dxSpan = p.x - p.ox;
  const dySpan = predictedY - p.oy;
  const angleDeg = radToDeg(Math.atan2(dySpan, dxSpan));

  if (
    angleDeg < C.FACEPLANT_ANGLE_DEG &&
    !s.flags.bounce &&
    !s.flags.superbounce &&
    !s.flags.slide
  ) {
    // Ordinary bounce.
    p.y = C.BOUNCE_RESET_Y;
    p.xvel *= C.BOUNCE_F;
    p.yvel /= C.PLAIN_BOUNCE_Y_DIV;
    if (!s.flags.skidding) {
      out.push({ t: 'fx', id: 'bounceFx', x: p.x, y: 955 });
      out.push({ t: 'sfx', id: 'bump', gain: C.SFX_VOLUME });
    }
  } else if (s.flags.bounce) {
    p.y = C.BOUNCE_RESET_Y;
    p.xvel *= C.BOUNCE_F;
    p.yvel *= C.BOUNCE_Y_MUL;
    if (p.yvel > C.BOUNCE_Y_MIN) p.yvel = C.BOUNCE_Y_MIN;
    s.flags.bounce = false;
    p.hit = false;
    out.push({ t: 'sfx', id: 'bounce', gain: C.SFX_VOLUME });
    out.push({ t: 'fx', id: 'break', x: p.x, y: 955 });
  } else if (s.flags.superbounce) {
    p.y = C.BOUNCE_RESET_Y;
    // The original writes `1 + this.f`, not a literal 1.6.
    p.xvel *= 1 + C.BOUNCE_F;
    p.yvel *= C.SUPERBOUNCE_Y_MUL;
    if (p.yvel > C.SUPERBOUNCE_Y_MIN) p.yvel = C.SUPERBOUNCE_Y_MIN;
    s.flags.superbounce = false;
    p.hit = false;
    out.push({ t: 'sfx', id: 'superbounce', gain: C.SFX_VOLUME });
    out.push({ t: 'fx', id: 'superBreak', x: p.x, y: 955 });
  } else if (angleDeg > C.FACEPLANT_ANGLE_DEG) {
    // Faceplant: the shot ends here.
    p.y = C.GROUND_Y;
    p.xvel = 0;
    p.yvel = 0;
    // Usually step 11 stops `sndFly` again on this same tick, as the original
    // does via `resetSounds()`. Not always: a speed or wind pulse landing on
    // this tick adds xvel back at step 4, so the stop here is load-bearing.
    out.push({ t: 'sfxStop', id: 'fly' });
    // A steep impact is punished twice: faceplant instead of bounce, and the
    // crater animation instead of the ordinary one.
    s.outcome = s.flags.falling ? 'hole' : 'faceplant';
    if (!s.flags.falling) out.push({ t: 'sfx', id: 'hit', gain: C.SFX_VOLUME });
  } else if (s.flags.slide) {
    p.y = C.GROUND_Y;
    p.xvel *= C.SLIDE_F;
    p.yvel /= C.PLAIN_BOUNCE_Y_DIV;
    if (!s.flags.skidding) out.push({ t: 'sfx', id: 'bump', gain: C.SFX_VOLUME });
  } else {
    // Reached when the angle is exactly 70: neither `< 70` nor `> 70`.
    p.y = C.GROUND_Y;
    p.xvel *= C.BOUNCE_F;
    p.yvel /= C.PLAIN_BOUNCE_Y_DIV;
    if (!s.flags.skidding) out.push({ t: 'sfx', id: 'bump', gain: C.SFX_VOLUME });
  }

  // Every branch ends with `this.falling = false` (Game.as:826, 860, ...). The
  // sibling `glide` flag emits its off-cue above; this one must too, or a
  // renderer that saw `falling: true` never learns the drop pose is over.
  clearFalling(s.flags, out);
}
