import { SOUNDS } from "@/assets/sounds.generated.ts";
import type { SimEvent, SoundId } from "@/sim/events.ts";

/**
 * The simulation's sound cues, played the way the original's `Sound` objects
 * played them.
 *
 * Each `SoundId` is one Flash `Sound` on its own clip (`createSound`,
 * Game.as:274-279), and that is what the semantics follow: `setVolume` is the
 * whole object's volume, so it changes every instance already playing;
 * `start()` adds an instance rather than restarting one; `stop()` stops them
 * all. Volumes are Flash's 0-100, clamped to it.
 *
 * Nothing here feeds back into the simulation. Browsers only let audio start
 * from a user gesture, so until `unlock()` the player only keeps track of which
 * loops ought to be running and starts them once it can; one-shots from before
 * then are dropped, as they would be too late to mean anything. Once unlocked,
 * a one-shot whose file is still decoding waits for it - and plays if that
 * takes less than `PENDING_GRACE_SEC` past its time, which covers the first
 * click's wheel squeak on a cold cache without a cheer arriving seconds late.
 */

/** The stage rate the timeline sounds are scheduled in (`delayFrames`). */
const STAGE_FPS = 19;
/** `doFade` - volume down 3 every 50 ms until it reaches 0. Game.as:314-323. */
const FADE_STEP = 3;
const FADE_MS = 50;
/** `toggleMusic()` brings the music back at 60, not at the 80 it started at. Game.as:307. */
const MUSIC_UNMUTED_VOL = 60;
/** How late a one-shot that was waiting for its file may still start. */
const PENDING_GRACE_SEC = 0.25;

const MUSIC: ReadonlySet<SoundId> = new Set(["prelude", "theme", "ending"]);

/**
 * What the `StartSound` tags do to the timeline sounds beyond their level,
 * which the simulation passes as the cue's gain. Out points are in 44.1 kHz
 * samples whatever the sound's rate, as SWF sound info always is.
 */
const SHAPING: Partial<
  Record<
    SoundId,
    {
      /** `LoopCount` - total plays. */
      readonly plays?: number;
      /** `OutPoint`, in seconds from the start. */
      readonly outSec?: number;
      /** A linear envelope to silence, in seconds from the start. */
      readonly fadeToSec?: number;
      /** Restarted every this many stage frames while the cue loops. */
      readonly retriggerFrames?: number;
    }
  >
> = {
  // hamsterWheel2 frame 2: loops 2.
  wheel: { plays: 2 },
  // hit_hole frame 1: out point 44160.
  hole: { outSec: 44160 / 44100 },
  // _speed frame 2: full, falling to nothing at 30600, out at 30800.
  speed: { fadeToSec: 30600 / 44100, outSec: 30800 / 44100 },
  // Clip 51 restarts it on each pass of its four-frame loop.
  tumble: { retriggerFrames: 4 },
};

interface Channel {
  /** Null until there is a context to make one in. */
  gain: GainNode | null;
  /** The Flash volume, 0-100. */
  volume: number;
  readonly voices: Set<AudioBufferSourceNode>;
  /** A looping cue is wanted, whether or not it could be started yet. */
  loopWanted: boolean;
}

export interface AudioPlayerOptions {
  /** Where each sound's MP3 is. */
  readonly urls: Readonly<Record<SoundId, string>>;
  /** Injected so the tests can run without a browser. */
  readonly createContext?: () => AudioContext;
  readonly fetchBytes?: (url: string) => Promise<ArrayBuffer>;
}

export class AudioPlayer {
  readonly #urls: Readonly<Record<SoundId, string>>;
  readonly #createContext: () => AudioContext;
  readonly #fetchBytes: (url: string) => Promise<ArrayBuffer>;
  #ctx: AudioContext | null = null;
  readonly #channels = new Map<SoundId, Channel>();
  readonly #buffers = new Map<SoundId, AudioBuffer>();
  /** One-shots cued after the unlock but before their file had decoded: when they were due. */
  readonly #pending = new Map<SoundId, number[]>();
  #paused = false;
  /** `MUSIC_MUTE`. */
  #musicMuted = false;
  /** `MUSIC_VOL` once the button has set it; until then, the cue's own. */
  #musicVol: number | null = null;
  /** `sndFadeInterval` - there is one, so a new fade abandons the old one. */
  #fade: { id: SoundId; timer: ReturnType<typeof setInterval> } | null = null;

  constructor(options: AudioPlayerOptions) {
    this.#urls = options.urls;
    this.#createContext = options.createContext ?? (() => new AudioContext());
    this.#fetchBytes =
      options.fetchBytes ??
      (async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.arrayBuffer();
      });
  }

  get musicMuted(): boolean {
    return this.#musicMuted;
  }

  /** From a user gesture: create or resume the context, and start loading. */
  unlock(): void {
    if (this.#ctx === null) {
      const ctx = this.#createContext();
      this.#ctx = ctx;
      for (const channel of this.#channels.values()) this.#connect(ctx, channel);
      void this.#loadAll(ctx);
    }
    if (!this.#paused) void this.#ctx.resume();
  }

  setPaused(paused: boolean): void {
    if (paused === this.#paused) return;
    this.#paused = paused;
    if (this.#ctx === null) return;
    void (paused ? this.#ctx.suspend() : this.#ctx.resume());
  }

  /** `toggleMusic()` - Game.as:294-312. Music only; the effects stay on. */
  toggleMusic(): boolean {
    this.#musicMuted = !this.#musicMuted;
    this.#musicVol = this.#musicMuted ? 0 : MUSIC_UNMUTED_VOL;
    for (const id of MUSIC) {
      const channel = this.#channels.get(id);
      if (channel !== undefined) this.#setVolume(channel, this.#musicVol);
    }
    // `doFade` stops the sound it is fading once the music is muted.
    if (this.#musicMuted && this.#fade !== null && MUSIC.has(this.#fade.id)) {
      const id = this.#fade.id;
      this.#endFade();
      this.#stop(id);
    }
    return this.#musicMuted;
  }

  consume(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.t === "sfx") {
        const volume = MUSIC.has(event.id)
          ? (this.#musicVol ?? event.gain ?? 100)
          : (event.gain ?? 100);
        const channel = this.#channel(event.id);
        this.#setVolume(channel, volume);
        if (event.loop === true) channel.loopWanted = true;
        const ctx = this.#ctx;
        if (ctx !== null && event.loop !== true && !this.#buffers.has(event.id)) {
          const due = ctx.currentTime + (event.delayFrames ?? 0) / STAGE_FPS;
          this.#pending.set(event.id, [...(this.#pending.get(event.id) ?? []), due]);
          continue;
        }
        this.#play(event.id, event.delayFrames ?? 0, event.loop === true);
      } else if (event.t === "sfxStop") {
        const channel = this.#channels.get(event.id);
        if (channel === undefined) continue;
        channel.loopWanted = false;
        this.#pending.delete(event.id);
        if (event.fade === true && channel.voices.size > 0) this.#startFade(event.id);
        else this.#stop(event.id);
      } else if (event.t === "sfxGain") {
        this.#setVolume(this.#channel(event.id), event.gain);
      }
    }
  }

  // -- internals -------------------------------------------------------------

  #channel(id: SoundId): Channel {
    let channel = this.#channels.get(id);
    if (channel === undefined) {
      channel = { gain: null, volume: 100, voices: new Set(), loopWanted: false };
      if (this.#ctx !== null) this.#connect(this.#ctx, channel);
      this.#channels.set(id, channel);
    }
    return channel;
  }

  #connect(ctx: AudioContext, channel: Channel): void {
    const gain = ctx.createGain();
    gain.gain.value = channel.volume / 100;
    gain.connect(ctx.destination);
    channel.gain = gain;
  }

  #setVolume(channel: Channel, volume: number): void {
    channel.volume = Math.min(100, Math.max(0, volume));
    if (channel.gain !== null) channel.gain.gain.value = channel.volume / 100;
  }

  #play(id: SoundId, delayFrames: number, loop: boolean): void {
    const ctx = this.#ctx;
    const buffer = this.#buffers.get(id);
    const channel = this.#channels.get(id);
    const gain = channel?.gain ?? null;
    if (ctx === null || buffer === undefined || channel === undefined || gain === null) return;
    const meta = SOUNDS[id];
    const shaping = SHAPING[id] ?? {};
    const when = ctx.currentTime + delayFrames / STAGE_FPS;
    // The DefineSound's own extent: past the encoder latency, for its samples.
    const offset = Math.min(meta.seek / meta.rate, buffer.duration);
    const length = Math.max(0, Math.min(meta.samples / meta.rate, buffer.duration - offset));

    const source = ctx.createBufferSource();
    let out: AudioNode = gain;
    if (loop && shaping.retriggerFrames !== undefined) {
      source.buffer = retriggered(ctx, buffer, offset, length, shaping.retriggerFrames / STAGE_FPS);
      source.loop = true;
      source.connect(out);
      source.start(when);
    } else {
      source.buffer = buffer;
      if (shaping.fadeToSec !== undefined) {
        const envelope = ctx.createGain();
        envelope.gain.setValueAtTime(1, when);
        envelope.gain.linearRampToValueAtTime(0, when + shaping.fadeToSec);
        envelope.connect(gain);
        out = envelope;
      }
      source.connect(out);
      const plays = loop ? Number.POSITIVE_INFINITY : (shaping.plays ?? 1);
      if (plays > 1) {
        source.loop = true;
        source.loopStart = offset;
        source.loopEnd = offset + length;
      }
      source.start(when, offset);
      const end = Math.min(length * plays, shaping.outSec ?? Number.POSITIVE_INFINITY);
      if (Number.isFinite(end)) source.stop(when + end);
    }
    channel.voices.add(source);
    source.onended = () => {
      channel.voices.delete(source);
    };
  }

  #stop(id: SoundId): void {
    const channel = this.#channels.get(id);
    if (channel === undefined) return;
    if (this.#fade?.id === id) this.#endFade();
    for (const voice of channel.voices) {
      try {
        voice.stop();
      } catch {
        // Already stopped or never started - either way, silent.
      }
    }
    channel.voices.clear();
  }

  #startFade(id: SoundId): void {
    // `fadeOutSound` clears the previous interval: a fade in progress is left
    // where it got to, still playing. Faithful, and audible only at game over.
    this.#endFade();
    const timer = setInterval(() => {
      if (this.#paused) return;
      const channel = this.#channels.get(id);
      if (channel === undefined) {
        this.#endFade();
        return;
      }
      const volume = channel.volume - FADE_STEP;
      this.#setVolume(channel, volume);
      if (volume <= 0 || this.#musicMuted) this.#stop(id);
    }, FADE_MS);
    this.#fade = { id, timer };
  }

  #endFade(): void {
    if (this.#fade === null) return;
    clearInterval(this.#fade.timer);
    this.#fade = null;
  }

  async #loadAll(ctx: AudioContext): Promise<void> {
    // The menu music first: it is the one that is already meant to be playing.
    const order = (Object.keys(this.#urls) as SoundId[]).sort(
      (a, b) => Number(b === "prelude") - Number(a === "prelude"),
    );
    await Promise.all(
      order.map(async (id) => {
        try {
          const bytes = await this.#fetchBytes(this.#urls[id]);
          const buffer = await ctx.decodeAudioData(bytes);
          this.#buffers.set(id, buffer);
          const channel = this.#channels.get(id);
          if (channel?.loopWanted === true && channel.voices.size === 0) this.#play(id, 0, true);
          for (const due of this.#pending.get(id) ?? []) {
            const ahead = due - ctx.currentTime;
            if (ahead >= -PENDING_GRACE_SEC) this.#play(id, Math.max(0, ahead) * STAGE_FPS, false);
          }
          this.#pending.delete(id);
        } catch (error) {
          // One sound missing is a quieter game, not a broken one.
          console.warn("[hamsterflight] sound %s unavailable: %o", id, error);
        }
      }),
    );
  }
}

/**
 * A loop of one retrigger period holding every overlapping instance - what the
 * steady state of "start it again every `period` seconds" sounds like, built
 * once instead of scheduling a start every 210 ms from a timer that would keep
 * running while the context is suspended.
 */
function retriggered(
  ctx: AudioContext,
  buffer: AudioBuffer,
  offset: number,
  length: number,
  period: number,
): AudioBuffer {
  const rate = buffer.sampleRate;
  const periodSamples = Math.max(1, Math.round(period * rate));
  const start = Math.round(offset * rate);
  const total = Math.round(length * rate);
  const out = ctx.createBuffer(buffer.numberOfChannels, periodSamples, rate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < periodSamples; i++) {
      let sum = 0;
      for (let k = i; k < total; k += periodSamples) sum += src[start + k] ?? 0;
      dst[i] = sum;
    }
  }
  return out;
}
