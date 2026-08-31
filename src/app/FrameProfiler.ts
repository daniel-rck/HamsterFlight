/** One window of draw timings, in milliseconds. */
export interface FrameStats {
  readonly label: string;
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

/**
 * Times whatever it wraps and reports percentiles over fixed windows.
 *
 * It lives outside both renderers on purpose. Instrumentation inside an
 * implementation is instrumentation that can flatter it - the wrapper here
 * sees exactly one thing, the wall-clock cost of a `draw()` call, and sees it
 * identically for every backend.
 *
 * The first window is discarded: it contains shader compilation, texture
 * uploads and JIT warmup, none of which is steady-state frame cost.
 */
export class FrameProfiler {
  readonly #label: string;
  readonly #window: number;
  readonly #samples: Float64Array;
  readonly #onReport: (stats: FrameStats) => void;
  readonly #reports: FrameStats[] = [];
  #index = 0;
  #windowsSeen = 0;
  #framesSeen = 0;

  constructor(label: string, window = 240, onReport: (stats: FrameStats) => void = logStats) {
    this.#label = label;
    this.#window = Math.max(1, window);
    this.#samples = new Float64Array(this.#window);
    this.#onReport = onReport;
  }

  /** Every window reported so far, warmup excluded. */
  get reports(): readonly FrameStats[] {
    return this.#reports;
  }

  /** Total frames measured, warmup included. Useful when no window closed yet. */
  get framesSeen(): number {
    return this.#framesSeen;
  }

  /** Runs `body`, records how long it took, and returns whatever it returned. */
  measure<T>(body: () => T): T {
    const started = performance.now();
    try {
      return body();
    } finally {
      this.#record(performance.now() - started);
    }
  }

  #record(ms: number): void {
    this.#framesSeen++;
    this.#samples[this.#index++] = ms;
    if (this.#index < this.#window) return;
    this.#index = 0;
    this.#windowsSeen++;
    // Window 1 is warmup: shader compiles, first texture uploads, cold JIT.
    if (this.#windowsSeen <= 1) return;
    const stats = this.#summarise();
    this.#reports.push(stats);
    this.#onReport(stats);
  }

  #summarise(): FrameStats {
    const sorted = Float64Array.from(this.#samples).sort();
    let total = 0;
    for (const value of sorted) total += value;
    return {
      label: this.#label,
      samples: this.#window,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: sorted[sorted.length - 1] ?? 0,
      mean: total / this.#window,
    };
  }
}

function percentile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

function logStats(stats: FrameStats): void {
  const ms = (value: number): string => value.toFixed(3).padStart(7);
  console.info(
    '[profile] %s  n=%d  p50=%sms  p95=%sms  p99=%sms  max=%sms  mean=%sms',
    stats.label,
    stats.samples,
    ms(stats.p50),
    ms(stats.p95),
    ms(stats.p99),
    ms(stats.max),
    ms(stats.mean),
  );
}
