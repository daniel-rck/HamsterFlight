import type { SimSnapshot } from "@/sim/state.ts";

/**
 * Where to draw between two ticks.
 *
 * The simulation snaps at 20 Hz and is authoritative; the display runs at 60
 * or 120. Drawing the newer snapshot on every frame moved the hamster and the
 * camera in 50 ms steps while the sprites and the sky ran smoothly, which read
 * as judder on the most watched object on screen. This lerps the positions
 * only - velocities, flags and everything else are the new tick's - and only
 * when the two snapshots are consecutive ticks of the same phase, so a launch,
 * a landing or a restart is never smeared across the transition.
 *
 * Presentation only: nothing here reaches the simulation, and the scores are
 * the same whatever is drawn in between.
 */
export function interpolate(
  prev: SimSnapshot | null,
  next: SimSnapshot,
  alpha: number,
): SimSnapshot {
  if (prev === null) return next;
  if (prev.phaseKind !== next.phaseKind || prev.tick !== next.tick - 1) return next;
  if (prev.turn !== next.turn) return next;
  // Clip 52's frame 28 moves the clip up 117.8 px in one go, with the art
  // moving back down the same amount - a cut, not a motion.
  if ((prev.windup === null) !== (next.windup === null)) return next;
  // Clamped at both ends, and alpha 0 is `prev` like every other alpha close to
  // it: returning `next` there drew a frame landing exactly on a tick boundary
  // one tick ahead, and the frame after it jumped back.
  const t = Math.min(1, Math.max(0, alpha));
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  return {
    ...next,
    hamster: {
      ...next.hamster,
      x: lerp(prev.hamster.x, next.hamster.x),
      y: lerp(prev.hamster.y, next.hamster.y),
    },
    camera: {
      x: lerp(prev.camera.x, next.camera.x),
      y: lerp(prev.camera.y, next.camera.y),
    },
  };
}
