import { C } from "../constants.ts";
import type { SimEvent } from "../events.ts";
import { overlaps } from "../math/aabb.ts";
import type { FlightState } from "../state.ts";
import type { Tuning } from "../tuning.ts";
import { type EffectFlags, POWERUPS, type PowerupKind } from "../types.ts";

/**
 * `Game.checkPowerUpsColl()` - Game.as:672-774.
 *
 * The guard asymmetry is real and reproduced deliberately: `bounce`, `slide`,
 * `superbounce` and `rebound` test their own flag before firing, but `speed`
 * (Game.as:719) and `wind` (Game.as:733) do not. So while the boxes overlap,
 * speed keeps adding 20 per tick and wind keeps adding its impulse. How many
 * ticks that is depends on the pickup clip's animation, which is not in the
 * constant table - hence `Tuning.powerupActiveTicks`.
 */
export function testPickups(s: FlightState, tuning: Tuning, out: SimEvent[]): void {
  const box = tuning.boxes.hamsterFlightCore;

  for (const it of s.powerups) {
    const live = !it.taken || it.activeTicksLeft > 0;
    if (live && overlaps(s.p.x, s.p.y, box, it.x, it.y, tuning.boxes.powerups[it.kind])) {
      apply(s, it.kind, out);
      if (!it.taken) {
        it.taken = true;
        it.activeTicksLeft = tuning.powerupActiveTicks[it.kind];
        out.push({ t: "pickup", kind: it.kind });
        if (POWERUPS[it.kind].sound) out.push({ t: "sfx", id: "pickup", gain: C.SFX_VOLUME });
      }
    }
    // Counted down whether or not the boxes still overlap, so a taken item
    // stops re-firing after its window however the hamster moves.
    if (it.taken && it.activeTicksLeft > 0) it.activeTicksLeft--;
  }
}

/** One kind's branch of the `switch`. Guarded kinds fire once, unguarded on every tick. */
function apply(s: FlightState, kind: PowerupKind, out: SimEvent[]): void {
  const flags = s.flags;
  switch (POWERUPS[kind].mode) {
    case "arm":
      if (kind === "bounce" ? flags.bounce : flags.superbounce) return;
      if (kind === "bounce") {
        flags.bounce = true;
        flags.superbounce = false;
      } else {
        flags.superbounce = true;
        flags.bounce = false;
      }
      // `this.falling = false; this.fallOff();` - Game.as:698, 713.
      clearFalling(flags, out);
      return;
    case "latch":
      if (flags.slide) return;
      flags.slide = true;
      return;
    case "impulse":
      if (flags.rebound) return;
      flags.rebound = true;
      // A rebound while dragging along the ground picks the hamster back up:
      // Game.as:757-766 drops `slide` (only if it was skidding), `skidding`
      // and `falling`. Leaving `skidding` set would have blocked glide for the
      // rest of the shot, since `onMouseDown` tests `!skidding`.
      if (flags.slide && flags.skidding) flags.slide = false;
      flags.skidding = false;
      clearFalling(flags, out);
      return;
    default:
      // pulse: speed and wind, no re-entry guard
      if (kind === "speed") flags.speed = true;
      else flags.wind = true;
  }
}

/** `fallOff()` as an event, so a renderer that saw `falling: true` sees it end. */
export function clearFalling(flags: EffectFlags, out: SimEvent[]): void {
  if (!flags.falling) return;
  flags.falling = false;
  out.push({ t: "falling", on: false });
}
