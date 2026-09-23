/**
 * The query-string knobs, parsed in one place so they can be tested without a
 * browser. Every one has a safe answer for garbage input.
 */

/** Renderer-only decoration multiplier; never touches the simulation. */
export const MAX_STRESS = 512;

export function seedFromUrl(params: URLSearchParams, random: () => number = randomSeed): number {
  const raw = params.get("seed");
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed >>> 0;
  }
  // Real runs still differ; pass ?seed=... to reproduce one exactly.
  return random();
}

function randomSeed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] ?? 1;
}

/**
 * Capped: `?stress=1000000` used to build seventy million star circles in the
 * renderer's constructor, before the first frame.
 */
export function stressFromUrl(params: URLSearchParams): number {
  const raw = params.get("stress");
  if (raw === null) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_STRESS);
}

/** Frames per profiler window; the default matches `FrameProfiler`'s. */
export function profileWindowFromUrl(params: URLSearchParams, fallback = 240): number {
  const parsed = Number.parseInt(params.get("profileWindow") ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Whether to open on the INSTRUCTIONS board, as root frame 6 does once per page
 * load. Not under `?profile`: the smoke test and the renderer bench drive the
 * game from the first frame and would only ever measure a board. `?instructions=0`
 * skips it by hand.
 */
export function instructionsFromUrl(params: URLSearchParams): boolean {
  if (params.has("profile")) return false;
  return params.get("instructions") !== "0";
}
