import { deepFreeze } from './freeze.ts';

/**
 * `erasableSyntaxOnly` is on, so no `enum` anywhere: const objects plus derived
 * unions give the same ergonomics with none of the emit.
 */

export const POWERUP_KINDS = [
  'bounce',
  'speed',
  'wind',
  'slide',
  'rebound',
  'superbounce',
] as const;

export type PowerupKind = (typeof POWERUP_KINDS)[number];

/**
 * How a powerup behaves on overlap. The distinction matters because the
 * original guards some kinds against re-triggering and others not:
 *
 *  - `arm`     stores a flag consumed by the next ground contact (guarded)
 *  - `pulse`   fires on every tick the boxes overlap (NOT guarded - Game.as:719
 *              has no `!this.speed` check, so a two-tick overlap really is +40)
 *  - `latch`   sets a mode for the rest of the shot (guarded)
 *  - `impulse` applies an immediate velocity change (guarded)
 */
export type PowerupMode = 'arm' | 'pulse' | 'latch' | 'impulse';

export interface PowerupSpec {
  readonly mode: PowerupMode;
  /** Ground item rather than airborne. */
  readonly groundItem: boolean;
  /**
   * Whether the pickup plays `sndPickup`. Only bounce (Game.as:700),
   * superbounce (:715) and slide (:749) do; speed, wind and rebound are
   * silent in the original.
   */
  readonly sound: boolean;
}

export const POWERUPS = deepFreeze({
  bounce: { mode: 'arm', groundItem: false, sound: true },
  speed: { mode: 'pulse', groundItem: false, sound: false },
  wind: { mode: 'pulse', groundItem: false, sound: false },
  slide: { mode: 'latch', groundItem: false, sound: true },
  rebound: { mode: 'impulse', groundItem: true, sound: false },
  superbounce: { mode: 'arm', groundItem: false, sound: true },
} as const satisfies Record<PowerupKind, PowerupSpec>);

/**
 * `random(11)` maps to a kind by range. Game.as:1288-1310.
 * 0-1 bounce, 2-4 speed, 5-7 wind, 8 slide, 9 rebound, 10 superbounce.
 */
export function powerupFromRoll(roll: number): PowerupKind {
  if (roll < 2) return 'bounce';
  if (roll < 5) return 'speed';
  if (roll < 8) return 'wind';
  if (roll === 8) return 'slide';
  if (roll === 9) return 'rebound';
  return 'superbounce';
}

/**
 * `zero` is the original's outcome for a jump that never met the pillow. This
 * port hands that turn back instead of scoring it, so the simulation no longer
 * produces one - `src/sim/drive.ts` still uses the name as a driver-side label
 * for "no shot happened".
 */
export type ShotOutcome = 'cheer' | 'faceplant' | 'hole' | 'zero';

/** Flags the original keeps as independent booleans; combinations are real. */
export interface EffectFlags {
  bounce: boolean;
  superbounce: boolean;
  slide: boolean;
  wind: boolean;
  speed: boolean;
  rebound: boolean;
  glide: boolean;
  falling: boolean;
  skidding: boolean;
}

export function noEffects(): EffectFlags {
  return {
    bounce: false,
    superbounce: false,
    slide: false,
    wind: false,
    speed: false,
    rebound: false,
    glide: false,
    falling: false,
    skidding: false,
  };
}
