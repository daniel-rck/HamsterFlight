import { C } from '../constants.ts';
import type { SimEvent } from '../events.ts';
import { overlaps } from '../math/aabb.ts';
import type { FlightState } from '../state.ts';
import type { Tuning } from '../tuning.ts';
import { POWERUPS } from '../types.ts';

/**
 * `Game.checkPowerUpsColl()` - Game.as:672-774.
 *
 * The guard asymmetry is real and reproduced deliberately: `bounce`, `slide`,
 * `superbounce` and `rebound` test their own flag before firing, but `speed`
 * (Game.as:719) and `wind` (Game.as:733) do not. So while the boxes overlap,
 * speed keeps adding 20 per tick and wind keeps adding its impulse. How many
 * ticks that is depends on the pickup clip's animation, which is not in the
 * constant table - hence `Tuning.powerupActiveTicks`.
 */
export function testPickups(s: FlightState, tuning: Tuning, out: SimEvent[]): void {
  const box = tuning.boxes.hamsterFlightCore;

  for (const it of s.powerups) {
    if (it.taken && it.activeTicksLeft <= 0) continue;

    const overlapping = overlaps(s.p.x, s.p.y, box, it.x, it.y, tuning.boxes.powerups[it.kind]);
    if (!overlapping) continue;

    const spec = POWERUPS[it.kind];
    const flags = s.flags;

    // Guarded kinds fire once; unguarded kinds fire on every overlapping tick.
    if (spec.mode === 'arm') {
      if (it.kind === 'bounce' ? flags.bounce : flags.superbounce) continue;
      if (it.kind === 'bounce') {
        flags.bounce = true;
        flags.superbounce = false;
      } else {
        flags.superbounce = true;
        flags.bounce = false;
      }
      flags.falling = false;
    } else if (spec.mode === 'latch') {
      if (flags.slide) continue;
      flags.slide = true;
    } else if (spec.mode === 'impulse') {
      if (flags.rebound) continue;
      flags.rebound = true;
    } else {
      // pulse: speed and wind, no re-entry guard
      if (it.kind === 'speed') flags.speed = true;
      else flags.wind = true;
    }

    if (!it.taken) {
      it.taken = true;
      it.activeTicksLeft = tuning.powerupActiveTicks[it.kind];
      out.push({ t: 'pickup', kind: it.kind });
      out.push({ t: 'sfx', id: 'pickup', gain: C.SFX_VOLUME });
    }
  }

  for (const it of s.powerups) {
    if (it.taken && it.activeTicksLeft > 0) it.activeTicksLeft--;
  }
}
