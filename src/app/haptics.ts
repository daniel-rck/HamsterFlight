import type { SimEvent } from "@/sim/events.ts";

/**
 * A short buzz for the moments a player feels in their hands: the pillow
 * connecting, a ball bursting, a hard landing. Milliseconds per event; kept
 * short, because a phone that rattles through a whole flight is a phone put
 * down. The page only asks for this on touch screens, and not at all when the
 * system asks for reduced motion.
 */
export function vibrationFor(events: readonly SimEvent[]): number {
  let ms = 0;
  for (const event of events) {
    if (event.t === "launched") ms = Math.max(ms, 25);
    else if (event.t === "fx" && event.id === "superBreak") ms = Math.max(ms, 35);
    else if (event.t === "fx") ms = Math.max(ms, 15);
    else if (event.t === "shotDone" && event.outcome !== "cheer") ms = Math.max(ms, 60);
  }
  return ms;
}
