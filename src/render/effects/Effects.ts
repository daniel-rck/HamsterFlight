import { SPRITES, type SpriteId } from '@/assets/sprites.generated.ts';
import type { FxId, SimEvent } from '@/sim/events.ts';

/** The three impact clips the original played and this port never drew. */
const FX_SPRITE: Record<FxId, SpriteId> = {
  bounceFx: 'fx/bounce',
  break: 'fx/break',
  superBreak: 'fx/superBreak',
};

/** Impact clips animate on the original stage rate, like every other sprite. */
const FX_FPS = 19;

/**
 * How hard each impact hits the camera, in stage pixels on a 600x400 view.
 * A faceplant carries no fx cue of its own but is the most violent thing that
 * happens to the hamster, so it gets one here.
 */
const SHAKE_AMPLITUDE: Record<FxId | 'faceplant', number> = {
  bounceFx: 1.5,
  break: 3,
  superBreak: 5,
  faceplant: 4,
};

const SHAKE_MS = 260;

/**
 * A hard impact also throws the colour channels apart for a moment. Only the
 * two breaking impacts, not the light bounce, and longer than the shake so the
 * eye reads it as a lens reacting rather than a second jolt.
 */
const ABERRATION_MS = 320;
const ABERRATION_STRENGTH: Partial<Record<FxId, number>> = {
  break: 0.55,
  superBreak: 1,
};
const TAU = Math.PI * 2;
/** Coprime-ish frequencies, so x and y do not trace a line. */
const SHAKE_FREQ_X = 6.1;
const SHAKE_FREQ_Y = 8.7;

export interface ShakeOffset {
  readonly x: number;
  readonly y: number;
}

const NO_SHAKE: ShakeOffset = { x: 0, y: 0 };

export interface ActiveFx {
  readonly sprite: SpriteId;
  readonly frame: number;
  /** World coordinates, as the simulation reported them. */
  readonly x: number;
  readonly y: number;
}

interface LiveFx {
  readonly sprite: SpriteId;
  readonly x: number;
  readonly y: number;
  readonly frames: number;
  readonly startedMs: number;
}

/**
 * Decoration driven by the simulation's event stream.
 *
 * `sim.step()` has always returned `SimEvent[]`, and `main.ts` has always
 * thrown it away - so `fx/bounce`, `fx/break` and `fx/superBreak` sat in the
 * manifest, extracted from the SWF, never once drawn. This reads that stream
 * and keeps the short-lived clips it asks for.
 *
 * Effects are decoration: they hold no simulation state and nothing in the
 * physics path reads them, exactly as `porting-notes.md` requires of clouds and
 * bushes. Time enters through the caller so this module stays testable.
 */
export interface EffectsOptions {
  /**
   * Camera shake on impact. Off in faithful mode: the original stage never
   * moved, so this is the one thing here that is an addition rather than a
   * restoration.
   */
  readonly shake?: boolean;
}

export class Effects {
  readonly #shakeEnabled: boolean;
  #live: LiveFx[] = [];
  #shakeStartedMs = 0;
  #shakeAmplitude = 0;
  #aberrationStartedMs = 0;
  #aberrationStrength = 0;

  constructor(options: EffectsOptions = {}) {
    this.#shakeEnabled = options.shake ?? false;
  }

  /** Takes one tick's events. Cues this layer has no use for are ignored. */
  consume(events: readonly SimEvent[], nowMs: number): void {
    for (const event of events) {
      if (event.t === 'fx') {
        const sprite = FX_SPRITE[event.id];
        this.#live.push({
          sprite,
          x: event.x,
          y: event.y,
          frames: SPRITES[sprite].frames,
          startedMs: nowMs,
        });
        this.#shake(SHAKE_AMPLITUDE[event.id], nowMs);
        const aberration = ABERRATION_STRENGTH[event.id];
        if (aberration !== undefined && aberration >= this.aberration(nowMs)) {
          this.#aberrationStartedMs = nowMs;
          this.#aberrationStrength = aberration;
        }
      } else if (event.t === 'shotDone' && event.outcome === 'faceplant') {
        this.#shake(SHAKE_AMPLITUDE.faceplant, nowMs);
      }
    }
  }

  /**
   * A jolt only replaces the one in flight if it is at least as strong as what
   * is left of it, so a light bounce cannot cut a superbounce short.
   */
  #shake(amplitude: number, nowMs: number): void {
    if (!this.#shakeEnabled) return;
    if (amplitude < this.#remainingShake(nowMs)) return;
    this.#shakeStartedMs = nowMs;
    this.#shakeAmplitude = amplitude;
  }

  #remainingShake(nowMs: number): number {
    const t = (nowMs - this.#shakeStartedMs) / SHAKE_MS;
    if (t < 0 || t >= 1) return 0;
    const decay = (1 - t) ** 2;
    return this.#shakeAmplitude * decay;
  }

  /**
   * Where to displace the world this frame, in stage pixels. Deterministic:
   * two decaying sinusoids off the impact time, no clock and no randomness, so
   * a given seed and command stream shake identically every replay.
   */
  shakeOffset(nowMs: number): ShakeOffset {
    const amplitude = this.#remainingShake(nowMs);
    if (amplitude === 0) return NO_SHAKE;
    const t = (nowMs - this.#shakeStartedMs) / SHAKE_MS;
    return {
      x: amplitude * Math.sin(t * TAU * SHAKE_FREQ_X),
      y: amplitude * Math.cos(t * TAU * SHAKE_FREQ_Y) * 0.7,
    };
  }

  /** What to draw this frame. Clips that have run out are dropped here. */
  active(nowMs: number): readonly ActiveFx[] {
    const out: ActiveFx[] = [];
    let keep = 0;
    for (const fx of this.#live) {
      const frame = Math.floor(((nowMs - fx.startedMs) / 1000) * FX_FPS);
      if (frame < 0 || frame >= fx.frames) continue;
      this.#live[keep++] = fx;
      out.push({ sprite: fx.sprite, frame, x: fx.x, y: fx.y });
    }
    this.#live.length = keep;
    return out;
  }

  /**
   * How far apart to throw the colour channels, 0 to 1. Decays linearly, and
   * like the shake it is a pure function of the impact time - no clock, no
   * randomness, so a replay looks identical.
   */
  aberration(nowMs: number): number {
    const t = (nowMs - this.#aberrationStartedMs) / ABERRATION_MS;
    if (t < 0 || t >= 1) return 0;
    return this.#aberrationStrength * (1 - t);
  }

  /** Drop everything in flight - on a restart, or when the tab comes back. */
  clear(): void {
    this.#live.length = 0;
    this.#shakeAmplitude = 0;
    this.#aberrationStrength = 0;
  }
}
