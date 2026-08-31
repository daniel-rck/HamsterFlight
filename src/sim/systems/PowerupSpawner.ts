import { C } from '../constants.ts';
import type { Rng } from '../rng/Rng.ts';
import type { FlightState } from '../state.ts';
import { POWERUPS, powerupFromRoll } from '../types.ts';

/**
 * `Game.generatePowerups()` - Game.as:1272-1335. One spawn per 150 px of
 * camera travel, 200 px right of the viewport edge.
 *
 * The RNG draw order is fixed and observable: `random(11)` for the type first
 * (Game.as:1284), then `random(1200)` for the height, and only for airborne
 * kinds. Swapping those two shifts every subsequent roll.
 */
export function spawnPowerups(s: FlightState, rng: Rng): void {
  if (C.SPAWN_GATE - s.camera.x < s.powerupMark) return;
  s.powerupMark += C.SPAWN_EVERY_PX;

  const kind = powerupFromRoll(rng.int(C.POWERUP_ROLL));
  const y = POWERUPS[kind].groundItem ? C.REBOUND_Y : C.POWERUP_Y_BASE - rng.int(C.POWERUP_Y_RAND);

  s.powerups.push({
    kind,
    x: C.SPAWN_AHEAD_X - s.camera.x,
    y,
    taken: false,
    activeTicksLeft: 0,
  });
}

/**
 * Powerups that have scrolled well off the left edge. Game.as:679-684.
 *
 * The original indexes with a counter but removes with `shift()` and never
 * decrements the counter, so it silently skips one entry on culling ticks. That
 * bug is dropped: spawns are strictly ordered by x, so culling from the front is
 * both correct and what the original meant.
 */
export function cullPowerups(s: FlightState): void {
  while (s.powerups.length > 0) {
    const head = s.powerups[0];
    if (head === undefined) break;
    if (s.camera.x + head.x >= C.POWERUP_CULL_X) break;
    s.powerups.shift();
  }
}
