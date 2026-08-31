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

/**
 * A ring of displacement travelling out from where the hamster hit. Slower
 * than the shake and the aberration, because it has to be seen crossing the
 * screen rather than felt as a jolt.
 */
const SHOCKWAVE_MS = 260;
const SHOCKWAVE_AMPLITUDE: Record<FxId, number> = {
  bounceFx: 0.04,
  break: 0.075,
  superBreak: 0.12,
};

export interface Shockwave {
  /** World coordinates of the impact; the camera moves, the wave does not. */
  readonly x: number;
  readonly y: number;
  /** 0 to 1 across the wave's life - the ring's radius. */
  readonly progress: number;
  readonly amplitude: number;
}
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
   * Everything this layer *adds* rather than restores: camera shake, chromatic
   * aberration, the shockwave. Off in faithful mode, where the original stage
   * neither moved nor warped. The impact clips are not gated by it - the
   * original played those, so leaving them out was the deviation.
   *
   * The renderer choice would hide the shader effects anyway, since Canvas2D
   * has no filters. Gating them here as well means `?mode=faithful` stays
   * faithful even when a backend is forced with `?renderer=`.
   */
  readonly enhanced?: boolean;
}

export class Effects {
  readonly #enhanced: boolean;
  #live: LiveFx[] = [];
  #shakeStartedMs = 0;
  #shakeAmplitude = 0;
  #aberrationStartedMs = 0;
  #aberrationStrength = 0;
  #waveStartedMs = 0;
  #waveAmplitude = 0;
  #waveX = 0;
  #waveY = 0;

  constructor(options: EffectsOptions = {}) {
    this.#enhanced = options.enhanced ?? false;
  }

  /** Whether the renderer should draw the additions as well as the original. */
  get enhanced(): boolean {
    return this.#enhanced;
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
        const aberration = this.#enhanced ? ABERRATION_STRENGTH[event.id] : undefined;
        if (aberration !== undefined && aberration >= this.aberration(nowMs)) {
          this.#aberrationStartedMs = nowMs;
          this.#aberrationStrength = aberration;
        }
        const wave = SHOCKWAVE_AMPLITUDE[event.id];
        if (this.#enhanced && wave >= (this.shockwave(nowMs)?.amplitude ?? 0)) {
          this.#waveStartedMs = nowMs;
          this.#waveAmplitude = wave;
          this.#waveX = event.x;
          this.#waveY = event.y;
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
    if (!this.#enhanced) return;
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

  /**
   * The expanding ring, or null when none is running. Like the shake and the
   * aberration it is a pure function of the impact time. The centre stays in
   * world coordinates so the wave remains anchored to the ground the hamster
   * hit while the camera keeps scrolling past it.
   */
  shockwave(nowMs: number): Shockwave | null {
    // Amplitude first: without it a zero-strength wave reads as live for the
    // first SHOCKWAVE_MS after the clock's epoch, and the filter attaches for
    // nothing on every boot.
    if (this.#waveAmplitude <= 0) return null;
    const progress = (nowMs - this.#waveStartedMs) / SHOCKWAVE_MS;
    if (progress <= 0 || progress >= 1) return null;
    return {
      x: this.#waveX,
      y: this.#waveY,
      progress,
      amplitude: this.#waveAmplitude,
    };
  }

  /** Drop everything in flight - on a restart, or when the tab comes back. */
  clear(): void {
    this.#live.length = 0;
    this.#shakeAmplitude = 0;
    this.#aberrationStrength = 0;
    this.#waveAmplitude = 0;
    this.#waveStartedMs = 0;
  }
}
