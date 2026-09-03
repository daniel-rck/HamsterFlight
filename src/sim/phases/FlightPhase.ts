import { C } from "../constants.ts";
import type { SimEvent } from "../events.ts";
import type { Rng } from "../rng/Rng.ts";
import type { FlightState } from "../state.ts";
import { follow } from "../systems/CameraModel.ts";
import { resolveGround } from "../systems/GroundCollision.ts";
import { testPickups } from "../systems/PowerupPickups.ts";
import { cullPowerups, spawnPowerups } from "../systems/PowerupSpawner.ts";
import type { Tuning } from "../tuning.ts";

/**
 * `Game.onUpdate()` - Game.as:474-654. One 50 ms tick.
 *
 * DO NOT REORDER. This function is deliberately a flat transcription rather
 * than a tidy composition, because the sequence is observable:
 *
 *   - ground collision (step 3) runs on the PREVIOUS tick's yvel, since gravity
 *     is not added until step 6;
 *   - powerup effects land after collision, so a wind pickup on a contact tick
 *     does not influence that bounce;
 *   - the skid test compares y at the top of the tick with the pre-move y and
 *     the predicted `y + yvel`, so it is a genuine two-tick predicate - on any
 *     tick where the ground did not intervene, `prevY` and `p.y` are the same
 *     value, and only the prediction can differ.
 *
 * Returns true when the shot is over.
 */
export function stepFlight(s: FlightState, tuning: Tuning, rng: Rng, out: SimEvent[]): boolean {
  const p = s.p;
  const prevY = p.y; // Game.as:500 - the skid predicate needs this

  // 1. spawns (clouds and bushes are decoration and live in the renderer)
  spawnPowerups(s, rng);

  // 2. powerup collision
  cullPowerups(s);
  testPickups(s, tuning, out);

  // 3. ground collision - before gravity, on purpose
  resolveGround(s, out);

  // 4. powerup effects
  if (s.flags.wind) {
    p.yvel += C.WIND_YVEL;
    p.xvel += C.WIND_XVEL;
    s.flags.wind = false;
    out.push({ t: "sfx", id: "wind", gain: C.SFX_VOLUME });
  }
  if (s.flags.speed) {
    p.xvel += C.SPEED_XVEL;
    s.flags.speed = false;
  }
  if (s.flags.rebound) {
    p.xvel = C.REBOUND_XVEL;
    p.yvel = C.REBOUND_YVEL;
    s.flags.rebound = false;
    p.doRotation = true;
    p.hit = false;
    // `sndSlide.stop(); slideSound = false` - Game.as:550-551.
    if (s.slideSound) {
      s.slideSound = false;
      out.push({ t: "sfxStop", id: "slide" });
    }
  }

  // The three-way sound branch, Game.as:556-592. The slide loop starts once
  // and then tracks |xvel|; the skid cue plays once; otherwise the flight loop
  // tracks the speed. Both loops duck `sndFly` to 5 when they start.
  if (s.flags.slide && s.flags.skidding) {
    p.doRotation = false;
    if (!s.slideSound) {
      s.slideSound = true;
      out.push({ t: "sfx", id: "slide", gain: C.SFX_VOLUME, loop: true });
      out.push({ t: "sfxGain", id: "fly", gain: 5 });
    } else {
      out.push({ t: "sfxGain", id: "slide", gain: slideGain(p.xvel) });
    }
  } else if (s.flags.skidding) {
    p.doRotation = false;
    if (!s.skidSound) {
      s.skidSound = true;
      out.push({ t: "sfx", id: "skid", gain: C.SFX_VOLUME });
      out.push({ t: "sfxGain", id: "fly", gain: 5 });
    }
  } else {
    out.push({ t: "sfxGain", id: "fly", gain: flyGain(p.xvel, p.yvel) });
  }

  if (s.flags.glide && (s.flags.falling || s.glidePoints === 0)) {
    s.flags.glide = false;
    out.push({ t: "glide", on: false });
  }

  // 5. air resistance - applies always
  p.xvel *= C.DRAG;

  // Not the original: `sim.js` recomputed the lift from the current xvel on
  // every held tick instead of freezing it at the press. Off by default.
  if (tuning.recomputeGlidePerTick && s.gravButton && s.glidePoints > 0) p.setGlideGravity();

  // 6. gravity
  p.yvel += p.grav;

  // 7. fall detection. The original writes `!this.bounce & !this.superbounce`
  // with a bitwise &, which happens to work because booleans coerce to 0/1.
  // Written as && here: provably identical for boolean operands.
  if (p.yvel > C.FALLING_YVEL && !s.flags.bounce && !s.flags.superbounce) {
    if (!s.flags.falling) {
      s.flags.falling = true;
      out.push({ t: "falling", on: true });
    }
  } else if (s.flags.falling) {
    s.flags.falling = false;
    out.push({ t: "falling", on: false });
  }

  // 8. skid detection - two ticks at or past the threshold, plus the prediction.
  // The skid *sound* belongs to the branch above and plays on the next tick,
  // exactly as `skidSound` does in the original.
  if (p.hit) {
    if (p.y >= C.SKID_Y && prevY >= C.SKID_Y && p.y + p.yvel >= C.SKID_Y) {
      s.flags.skidding = true;
    }
  }

  // 9. integration - captures ox/oy, then moves
  p.integrate();

  // 10. camera
  follow(s.camera, p.x, p.y);

  // 11. shot end
  if (p.xvel < 1 && p.hit) {
    if (s.outcome === null) s.outcome = "cheer";
    out.push({ t: "sfxStop", id: "fly" });
    if (s.slideSound) out.push({ t: "sfxStop", id: "slide" });
    return true;
  }

  // 12. glide meter
  if (s.gravButton) {
    s.glidePoints -= C.GLIDE_DRAIN;
    if (s.glidePoints <= 0) {
      s.glidePoints = 0;
      // The original calls restoreGravity every tick once the meter is empty,
      // while gravButton stays true and the drain keeps running.
      p.restoreGravity();
    }
  } else {
    s.glidePoints = Math.min(C.GLIDE_MAX, s.glidePoints + C.GLIDE_REGEN);
  }

  // A faceplant normally ends the shot at step 11, since it zeroes xvel. The
  // exception is a speed or wind pulse landing on the same tick: step 4 then
  // adds xvel back, and only the outcome says the shot is over.
  return s.outcome === "faceplant" || s.outcome === "hole";
}

/** `sndFly` gain: `floor(floor(|xvel| + |yvel|) / 70 * 100)`. Game.as:589-592. */
export function flyGain(xvel: number, yvel: number): number {
  return Math.floor((Math.floor(Math.abs(xvel) + Math.abs(yvel)) / 70) * 100);
}

/** `sndSlide` gain: `floor(floor(|xvel|) / 20 * 100)`. Game.as:569-572. */
export function slideGain(xvel: number): number {
  return Math.floor((Math.floor(Math.abs(xvel)) / 20) * 100);
}
