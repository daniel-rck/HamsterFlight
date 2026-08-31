/**
 * The original defines `pi = 3.141593` as a class constant in both `Game` and
 * `Bullet` and uses it for every degree/radian conversion instead of `Math.PI`.
 * Seven digits, so it is very slightly wrong - and reproducing it keeps golden
 * trajectories bit-stable against the reference implementation.
 */
// Math.PI here would be a fidelity bug: it changes the angle maths and every
// golden trajectory with it.
// biome-ignore lint/suspicious/noApproximativeNumericConstant: reproducing the original's truncated constant is the point
export const PI_AS2 = 3.141593;

/** `Game.radainsToDegrees` / `Bullet.radainsToDegrees` (typo is the original's). */
export function radToDeg(radians: number): number {
  return (radians * 180) / PI_AS2;
}

/** `Game.degreesToRadians` / `Bullet.degreesToRadians`. */
export function degToRad(degrees: number): number {
  return (degrees * PI_AS2) / 180;
}
