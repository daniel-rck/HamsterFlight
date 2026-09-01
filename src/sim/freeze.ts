/**
 * `Object.freeze` is shallow and TypeScript's `readonly` is erased, so a
 * nested table such as `DEFAULT_TUNING.powerupActiveTicks` was mutable at run
 * time - and a stray write there would have poisoned every Simulation created
 * afterwards. This freezes the whole tree once, at module load.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
