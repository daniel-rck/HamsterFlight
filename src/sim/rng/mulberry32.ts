import type { Rng } from './Rng.ts';

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32: 32 bits of state, four lines, and more than uniform enough for
 * `random(11)` powerup rolls. Chosen for reproducibility and for being small
 * enough to audit, not for cryptographic quality.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;

  const float = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    float,
    int: (n: number): number => Math.floor(float() * n),
    fork: (tag: string): Rng => mulberry32((seed ^ fnv1a(tag)) >>> 0),
  };
}
