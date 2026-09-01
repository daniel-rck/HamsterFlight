import type { Phase } from '../sim/state.ts';

/**
 * The state the launcher end of the world is in, shared by both backends so
 * they cannot drift apart.
 *
 * The simulation is not consulted for any of this: everything here is
 * decoration derived from the snapshot, which is the same rule the port
 * already applies to clouds and bushes.
 */

/**
 * True once `launch()` has fired.
 *
 * The original arms the launcher on the first click (`state = "jump"`) but
 * only swings on the second, and it is that second click that moves the
 * pillow to `PILLOW_LAUNCH_X`. Game.as:1016-1037, 1118-1121. It stays there
 * for the whole flight and is put back by `onDone()` when the camera has
 * panned home. Game.as:979-980.
 */
export function launched(phase: Phase['kind']): boolean {
  return phase === 'flying' || phase === 'settling';
}
