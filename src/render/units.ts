/**
 * The original is an American Flash game and scores in feet; `C.PX_PER_FOOT`
 * is bytecode fact and stays. Every length the port shows is in metres to two
 * decimals, in both modes - presentation only, converted here and nowhere else.
 */
const METRES_PER_FOOT = 0.3048;

export function feetToMetres(feet: number): number {
  return feet * METRES_PER_FOOT;
}

/**
 * Metres to the centimetre. The score itself stays whole feet - the original's
 * `updateDistance()` floors it - so the two decimals are that score converted
 * exactly, not a finer measurement.
 */
export function metres(feet: number): string {
  return `${feetToMetres(feet).toFixed(2)} m`;
}

/** Ground markers, in world pixels: a tick every 5 m and a label every 25 m. */
export interface MarkerScale {
  /** Distance between ticks, in the displayed unit. */
  readonly step: number;
  /** Every nth tick carries a label. */
  readonly labelEvery: number;
  /** World pixels per metre. */
  readonly pixels: number;
}

export function markerScale(pixelsPerFoot: number): MarkerScale {
  return { step: 5, labelEvery: 5, pixels: pixelsPerFoot / METRES_PER_FOOT };
}

/** A marker's label: whole metres on the scale, written like every other length. */
export function markerLabel(at: number): string {
  return `${at.toFixed(2)} m`;
}
