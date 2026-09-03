/**
 * The original is an American Flash game and scores in feet; `C.PX_PER_FOOT`
 * is bytecode fact and stays. This is presentation only, so enhanced mode can
 * show metres while faithful mode keeps the unit the original displayed.
 */
const METRES_PER_FOOT = 0.3048;

export function feetToMetres(feet: number): number {
  return feet * METRES_PER_FOOT;
}

/** A distance for the HUD, in whichever unit the mode calls for. */
export function distance(feet: number, metric: boolean): string {
  return metric ? `${Math.round(feetToMetres(feet))} m` : `${feet} ft`;
}

/**
 * Ground markers, in world pixels. Metres are shorter than feet, so the tick
 * spacing is chosen to land at a similar density on screen rather than at the
 * same number.
 */
export interface MarkerScale {
  /** Distance between ticks, in the displayed unit. */
  readonly step: number;
  /** Every nth tick carries a label. */
  readonly labelEvery: number;
  /** World pixels per unit. */
  readonly pixels: number;
  readonly suffix: string;
}

export function markerScale(pixelsPerFoot: number, metric: boolean): MarkerScale {
  return metric
    ? { step: 5, labelEvery: 5, pixels: pixelsPerFoot / METRES_PER_FOOT, suffix: "m" }
    : { step: 10, labelEvery: 5, pixels: pixelsPerFoot, suffix: "ft" };
}
