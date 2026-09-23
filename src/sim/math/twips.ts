/**
 * AVM1 stores a clip's `_x`/`_y` as whole twips, 1/20 px, so every write to a
 * clip property comes back quantised on the next read. The original keeps the
 * hamster's position, `ox`/`oy` (read back from the clip), the camera
 * container and the powerup positions as clip properties, so all of them sit
 * on the twip grid; velocities are plain `Number`s and do not.
 *
 * The rounding mode is an assumption, not a measurement: nothing here has been
 * checked against a Flash player. Nearest twip is used (`Math.round`, so an
 * exact half goes toward +infinity). Truncation toward zero - what Ruffle's
 * `Twips::from_pixels` may do - was tried and rejected for now: it biases
 * every position toward zero by up to one twip per write, which is enough to
 * flip the knife-edge relations in `test/golden/strategies.spec.ts`. If a
 * player trace ever settles the question, this is the one line to change.
 */
export const TWIPS_PER_PX = 20;

/** The value a clip property holds after `clip._x = px`. */
export function toTwips(px: number): number {
  return Math.round(px * TWIPS_PER_PX) / TWIPS_PER_PX;
}
