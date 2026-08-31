/**
 * The simulation must be reproducible: the same seed and the same command
 * stream have to yield the same trajectory, or the golden regression tests
 * cannot exist. So randomness is injected, never imported.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  float(): number;
  /** Exactly AS2 `random(n)` === `Math.floor(Math.random() * n)`. */
  int(n: number): number;
  /** An independent stream derived from the same master seed. */
  fork(tag: string): Rng;
}
