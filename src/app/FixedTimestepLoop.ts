/** Exactly one simulation step, then one draw. */
export interface LoopHooks {
  step(): void;
  /** `alpha` in [0,1) within the current tick; `stepped` is false on idle frames. */
  draw(alpha: number, stepped: boolean): void;
}

/** 20 Hz. Non-negotiable: every acceleration in the game is a per-tick value. */
const STEP_MS = 50;
const MAX_STEPS_PER_FRAME = 5;
/** Longer than this and the tab was away or a breakpoint was hit. */
const GAP_THRESHOLD_MS = 250;

/**
 * requestAnimationFrame drives an accumulator that steps the simulation in
 * fixed 50 ms increments. Delta-time integration is not an option here - the
 * original ran on `setInterval(..., 50)` and every constant is per tick, so
 * scaling by frame time changes trajectories and scores.
 */
export class FixedTimestepLoop {
  #accumulator = 0;
  #last = 0;
  #raf = 0;
  #running = false;

  readonly #hooks: LoopHooks;

  constructor(hooks: LoopHooks) {
    this.#hooks = hooks;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#last = performance.now();
    this.#accumulator = 0;
    this.#raf = requestAnimationFrame(this.#frame);
  }

  stop(): void {
    this.#running = false;
    cancelAnimationFrame(this.#raf);
  }

  get running(): boolean {
    return this.#running;
  }

  /** Call when returning from a hidden tab or a modal, before `start()`. */
  resync(): void {
    this.#last = performance.now();
    this.#accumulator = 0;
  }

  #frame = (now: number): void => {
    if (!this.#running) return;
    this.#raf = requestAnimationFrame(this.#frame);

    let elapsed = now - this.#last;
    this.#last = now;

    // Refuse to fast-forward. Replaying dozens of input-less physics ticks on
    // return from a background tab means a guaranteed faceplant.
    if (elapsed > GAP_THRESHOLD_MS) elapsed = STEP_MS;
    this.#accumulator += elapsed;

    let steps = 0;
    while (this.#accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      this.#hooks.step();
      this.#accumulator -= STEP_MS;
      steps++;
    }
    // Hard cap reached: bleed the surplus rather than accruing debt forever.
    if (steps === MAX_STEPS_PER_FRAME && this.#accumulator > STEP_MS) this.#accumulator = 0;

    this.#hooks.draw(this.#accumulator / STEP_MS, steps > 0);
  };
}
