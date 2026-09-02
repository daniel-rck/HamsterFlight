import { SPRITES, type SpriteId } from '@/assets/sprites.generated.ts';
import { PreLaunchScene } from '@/render/PreLaunchScene.ts';
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

/**
 * Particles are closed-form: position is a function of age, so nothing is
 * integrated per frame and the whole system stays a pure function of when each
 * one was born. Spread comes from a hashed counter rather than Math.random, for
 * the same reason the star field does it that way - a replay must look the same.
 */
const PARTICLE_LIMIT = 160;
const DUST_LIFE_MS = 420;
const SPARK_LIFE_MS = 340;
/** Dust is emitted while skidding; this is the gap between puffs. */
const DUST_INTERVAL_MS = 45;

export interface Particle {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly tint: number;
  /** 0 at birth, 1 at death. */
  readonly age: number;
}

interface LiveParticle {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly gravity: number;
  readonly size: number;
  readonly tint: number;
  readonly lifeMs: number;
  readonly bornMs: number;
}

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
   * aberration, the shockwave, the particles, plus the presentation choices
   * that ride on the mode - metres instead of feet, the translucent bubble.
   * Off in faithful mode, where the original stage neither moved nor warped.
   * The impact clips are not gated by it - the original played those, so
   * leaving them out was the deviation.
   *
   * The renderer choice would hide the shader effects anyway, since Canvas2D
   * has no filters. Gating them here as well means `?mode=faithful` stays
   * faithful even when a backend is forced with `?renderer=`.
   */
  readonly enhanced?: boolean;
  /**
   * The subset of `enhanced` that moves or warps the picture: shake,
   * aberration, shockwave, particles, motion blur. Defaults to `enhanced`;
   * `prefers-reduced-motion` turns it off on its own while the rest of the
   * enhanced presentation stays.
   */
  readonly motion?: boolean;
}

export class Effects {
  /**
   * The launcher, the hamster queue and the launch meter.
   *
   * It rides along here because it is driven by the same event stream and
   * reaches the renderers by the same route, but it is deliberately outside
   * the `enhanced` gate: it restores what the original drew rather than adding
   * to it, exactly like the `fx/*` clips above.
   */
  readonly scene = new PreLaunchScene();
  readonly #enhanced: boolean;
  readonly #motion: boolean;
  #live: LiveFx[] = [];
  #shakeStartedMs = 0;
  #shakeAmplitude = 0;
  #aberrationStartedMs = 0;
  #aberrationStrength = 0;
  #waveStartedMs = 0;
  #waveAmplitude = 0;
  #waveX = 0;
  #waveY = 0;
  #particles: LiveParticle[] = [];
  #emitted = 0;
  #lastDustMs = Number.NEGATIVE_INFINITY;

  constructor(options: EffectsOptions = {}) {
    this.#enhanced = options.enhanced ?? false;
    this.#motion = options.motion ?? this.#enhanced;
  }

  /** Whether the renderer should draw the additions as well as the original. */
  get enhanced(): boolean {
    return this.#enhanced;
  }

  /** Whether anything may shake, warp, blur or scatter. */
  get motion(): boolean {
    return this.#motion;
  }

  /**
   * A deterministic value in [0, 1) drawn from a counter, so two runs of the
   * same seed and inputs scatter their particles identically.
   */
  #roll(): number {
    this.#emitted = (this.#emitted + 1) | 0;
    return ((Math.imul(this.#emitted, 0x9e3779b1) >>> 8) % 10000) / 10000;
  }

  #spawn(particle: LiveParticle): void {
    if (this.#particles.length >= PARTICLE_LIMIT) return;
    this.#particles.push(particle);
  }

  /** Dust kicked up along the ground, while the hamster is still sliding. */
  emitSkidDust(x: number, y: number, nowMs: number): void {
    if (!this.#motion) return;
    if (nowMs - this.#lastDustMs < DUST_INTERVAL_MS) return;
    this.#lastDustMs = nowMs;
    for (let i = 0; i < 3; i++) {
      this.#spawn({
        x,
        y,
        // Thrown backwards and up, the way grit comes off a skid.
        vx: -(0.25 + this.#roll() * 0.55),
        vy: -(0.12 + this.#roll() * 0.32),
        gravity: 0.0022,
        size: 1.6 + this.#roll() * 2.4,
        tint: 0xd9c9a8,
        lifeMs: DUST_LIFE_MS,
        bornMs: nowMs,
      });
    }
  }

  /** A burst where a powerup was taken. */
  #emitSparks(x: number, y: number, nowMs: number): void {
    for (let i = 0; i < 12; i++) {
      const angle = this.#roll() * Math.PI * 2;
      const speed = 0.22 + this.#roll() * 0.5;
      this.#spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0.0016,
        size: 1.4 + this.#roll() * 2,
        tint: 0xffe07a,
        lifeMs: SPARK_LIFE_MS,
        bornMs: nowMs,
      });
    }
  }

  /** Where the particles are this frame. A pure read; `prune()` drops the dead. */
  particles(nowMs: number): readonly Particle[] {
    const out: Particle[] = [];
    for (const p of this.#particles) {
      const elapsed = nowMs - p.bornMs;
      if (elapsed < 0 || elapsed >= p.lifeMs) continue;
      out.push({
        x: p.x + p.vx * elapsed,
        y: p.y + p.vy * elapsed + 0.5 * p.gravity * elapsed * elapsed,
        size: p.size,
        tint: p.tint,
        age: elapsed / p.lifeMs,
      });
    }
    return out;
  }

  /**
   * Drop the clips and particles that have run out. Called once per frame by
   * the loop, so `active()` and `particles()` can stay pure reads - a debug
   * overlay or a test asking about an earlier moment no longer destroys what
   * the renderer was about to draw.
   */
  prune(nowMs: number): void {
    let keep = 0;
    for (const fx of this.#live) {
      const frame = Math.floor(((nowMs - fx.startedMs) / 1000) * FX_FPS);
      if (frame >= fx.frames) continue;
      this.#live[keep++] = fx;
    }
    this.#live.length = keep;

    keep = 0;
    for (const p of this.#particles) {
      if (nowMs - p.bornMs >= p.lifeMs) continue;
      this.#particles[keep++] = p;
    }
    this.#particles.length = keep;
  }

  /** Takes one tick's events. Cues this layer has no use for are ignored. */
  consume(events: readonly SimEvent[], nowMs: number, at?: { x: number; y: number }): void {
    this.scene.consume(events, nowMs);
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
        const aberration = this.#motion ? ABERRATION_STRENGTH[event.id] : undefined;
        if (aberration !== undefined && aberration >= this.aberration(nowMs)) {
          this.#aberrationStartedMs = nowMs;
          this.#aberrationStrength = aberration;
        }
        const wave = SHOCKWAVE_AMPLITUDE[event.id];
        if (this.#motion && wave >= (this.shockwave(nowMs)?.amplitude ?? 0)) {
          this.#waveStartedMs = nowMs;
          this.#waveAmplitude = wave;
          this.#waveX = event.x;
          this.#waveY = event.y;
        }
      } else if (event.t === 'shotDone' && event.outcome === 'faceplant') {
        this.#shake(SHAKE_AMPLITUDE.faceplant, nowMs);
      } else if (event.t === 'pickup' && this.#motion && at !== undefined) {
        // The cue carries only the kind, so the burst goes where the hamster
        // was - which is where the overlap happened.
        this.#emitSparks(at.x, at.y, nowMs);
      }
    }
  }

  /**
   * A jolt only replaces the one in flight if it is at least as strong as what
   * is left of it, so a light bounce cannot cut a superbounce short.
   */
  #shake(amplitude: number, nowMs: number): void {
    if (!this.#motion) return;
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

  /** What to draw this frame. A pure read; `prune()` drops finished clips. */
  active(nowMs: number): readonly ActiveFx[] {
    const out: ActiveFx[] = [];
    for (const fx of this.#live) {
      const frame = Math.floor(((nowMs - fx.startedMs) / 1000) * FX_FPS);
      if (frame < 0 || frame >= fx.frames) continue;
      out.push({ sprite: fx.sprite, frame, x: fx.x, y: fx.y });
    }
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
    this.scene.clear();
    this.#live.length = 0;
    this.#shakeStartedMs = 0;
    this.#shakeAmplitude = 0;
    this.#aberrationStartedMs = 0;
    this.#aberrationStrength = 0;
    this.#waveAmplitude = 0;
    this.#waveStartedMs = 0;
    this.#particles.length = 0;
    // Back to the start of the hash sequence too, or a restart would scatter
    // its particles differently from a first run with the same seed.
    this.#emitted = 0;
    this.#lastDustMs = Number.NEGATIVE_INFINITY;
  }
}
