import type { FrameProfiler } from '@/app/FrameProfiler.ts';

declare global {
  interface Window {
    /**
     * Only under `?profile`: lets scripts/bench-renderers.ts and smoke.ts read
     * the profiler's windows as data rather than scraping console output.
     */
    __hamsterProfile?: FrameProfiler;
  }
}
