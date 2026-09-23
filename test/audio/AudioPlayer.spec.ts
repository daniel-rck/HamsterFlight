import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOUNDS } from "@/assets/sounds.generated.ts";
import { AudioPlayer } from "@/audio/AudioPlayer.ts";
import type { SimEvent, SoundId } from "@/sim/events.ts";

/** Just enough of Web Audio to watch what the player asks of it. */
class FakeParam {
  value = 1;
  readonly ramps: [number, number][] = [];
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.ramps.push([v, t]);
  }
}

class FakeNode {
  readonly gain = new FakeParam();
  connect(): void {}
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  startedAt: [number, number | undefined] | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(when: number, offset?: number): void {
    this.startedAt = [when, offset];
  }
  stop(when?: number): void {
    this.stoppedAt = when ?? -1;
  }
}

class FakeBuffer {
  readonly sampleRate = 22050;
  readonly numberOfChannels = 1;
  readonly duration: number;
  readonly #data: Float32Array;
  constructor(duration: number) {
    this.duration = duration;
    this.#data = new Float32Array(Math.ceil(duration * this.sampleRate));
  }
  getChannelData(): Float32Array {
    return this.#data;
  }
}

class FakeContext {
  currentTime = 10;
  state = "suspended";
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeNode[] = [];
  resume = vi.fn<() => Promise<void>>(async () => {
    this.state = "running";
  });
  suspend = vi.fn<() => Promise<void>>(async () => {
    this.state = "suspended";
  });
  createGain(): FakeNode {
    const node = new FakeNode();
    this.gains.push(node);
    return node;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createBuffer(_channels: number, length: number, rate: number): FakeBuffer {
    return new FakeBuffer(length / rate);
  }
  async decodeAudioData(bytes: ArrayBuffer): Promise<FakeBuffer> {
    // The fetch below encodes the sound's id in the byte length.
    const id = ID_BY_LENGTH.get(bytes.byteLength) as SoundId;
    const meta = SOUNDS[id];
    return new FakeBuffer((meta.seek + meta.samples) / meta.rate + 0.05);
  }
}

const IDS = Object.keys(SOUNDS) as SoundId[];
const ID_BY_LENGTH = new Map(IDS.map((id, i) => [i + 1, id]));
const urls = Object.fromEntries(IDS.map((id) => [id, id])) as Record<SoundId, string>;

async function unlocked(): Promise<{ player: AudioPlayer; ctx: FakeContext }> {
  const ctx = new FakeContext();
  const player = new AudioPlayer({
    urls,
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => new ArrayBuffer(IDS.indexOf(url as SoundId) + 1),
  });
  player.unlock();
  // Let every fetch and decode settle.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { player, ctx };
}

const started = (ctx: FakeContext, id: SoundId) =>
  ctx.sources.filter((s) => s.buffer !== null && s.startedAt !== null && sourceId(s) === id);

/** Which sound a source plays, recovered from its buffer length. */
function sourceId(source: FakeSource): SoundId | null {
  for (const id of IDS) {
    const meta = SOUNDS[id];
    if (source.buffer?.duration === (meta.seek + meta.samples) / meta.rate + 0.05) return id;
  }
  return null;
}

describe("AudioPlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("remembers a loop asked for before the first gesture and starts it once it can", async () => {
    const ctx = new FakeContext();
    const player = new AudioPlayer({
      urls,
      createContext: () => ctx as unknown as AudioContext,
      fetchBytes: async (url) => new ArrayBuffer(IDS.indexOf(url as SoundId) + 1),
    });
    // The menu music starts before anyone has clicked; a one-shot too.
    player.consume([
      { t: "sfx", id: "prelude", gain: 80, loop: true },
      { t: "sfx", id: "shoot", gain: 100 },
    ]);
    expect(ctx.sources).toHaveLength(0);
    player.unlock();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.resume).toHaveBeenCalled();
    const prelude = started(ctx, "prelude");
    expect(prelude).toHaveLength(1);
    expect(prelude[0]?.loop).toBe(true);
    // Too late to mean anything, so dropped.
    expect(started(ctx, "shoot")).toHaveLength(0);
  });

  it("plays from past the encoder latency, for the DefineSound's own length", async () => {
    const { player, ctx } = await unlocked();
    player.consume([{ t: "sfx", id: "hit", gain: 100 }]);
    const [hit] = started(ctx, "hit");
    const meta = SOUNDS.hit;
    expect(hit?.startedAt).toEqual([10, meta.seek / meta.rate]);
    expect(hit?.stoppedAt).toBeCloseTo(10 + meta.samples / meta.rate, 9);
    // A loop is looped on the same extent.
    player.consume([{ t: "sfx", id: "fly", gain: 100, loop: true }]);
    const [fly] = started(ctx, "fly");
    expect(fly?.loopStart).toBeCloseTo(SOUNDS.fly.seek / SOUNDS.fly.rate, 9);
    expect(fly?.loopEnd).toBeCloseTo((SOUNDS.fly.seek + SOUNDS.fly.samples) / SOUNDS.fly.rate, 9);
  });

  it("schedules timeline sounds in stage frames", async () => {
    const { player, ctx } = await unlocked();
    player.consume([{ t: "sfx", id: "cheer", gain: 79, delayFrames: 4 }]);
    expect(started(ctx, "cheer")[0]?.startedAt?.[0]).toBeCloseTo(10 + 4 / 19, 9);
  });

  it("treats volume as the whole Sound's, as setVolume does", async () => {
    const { player, ctx } = await unlocked();
    const events: SimEvent[] = [
      { t: "sfx", id: "fly", gain: 100, loop: true },
      { t: "sfxGain", id: "fly", gain: 5 },
    ];
    player.consume(events);
    const gains = ctx.gains.map((g) => g.gain.value);
    expect(gains).toContain(0.05);
  });

  it("fades by 3 every 50 ms, then stops", async () => {
    const { player, ctx } = await unlocked();
    player.consume([{ t: "sfx", id: "theme", gain: 80, loop: true }]);
    player.consume([{ t: "sfxStop", id: "theme", fade: true }]);
    const [theme] = started(ctx, "theme");
    expect(theme?.stoppedAt).toBeNull();
    vi.advanceTimersByTime(50 * 26);
    expect(theme?.stoppedAt).toBeNull();
    vi.advanceTimersByTime(50);
    // 80 - 27 * 3 <= 0.
    expect(theme?.stoppedAt).toBe(-1);
  });

  it("mutes the music only, and brings it back at 60", async () => {
    const { player, ctx } = await unlocked();
    player.consume([
      { t: "sfx", id: "prelude", gain: 80, loop: true },
      { t: "sfx", id: "fly", gain: 100, loop: true },
    ]);
    expect(ctx.gains.map((g) => g.gain.value)).toEqual([0.8, 1]);
    expect(player.toggleMusic()).toBe(true);
    // The prelude went to 0; the flight loop did not move.
    expect(ctx.gains.map((g) => g.gain.value)).toEqual([0, 1]);
    expect(player.toggleMusic()).toBe(false);
    expect(ctx.gains.map((g) => g.gain.value)).toContain(0.6);
    // And later music starts at 60 too, not at the cue's 80.
    player.consume([{ t: "sfx", id: "ending", gain: 80 }]);
    expect(ctx.gains.map((g) => g.gain.value).filter((v) => v === 0.6)).toHaveLength(2);
  });

  it("suspends and resumes with the game's pause", async () => {
    const { player, ctx } = await unlocked();
    player.setPaused(true);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    player.setPaused(true);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    player.setPaused(false);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it("shapes the speed pickup's sound with its StartSound envelope", async () => {
    const { player, ctx } = await unlocked();
    player.consume([{ t: "sfx", id: "speed", gain: 100 }]);
    const [speed] = started(ctx, "speed");
    expect(speed?.stoppedAt).toBeCloseTo(10 + 30800 / 44100, 9);
    const envelope = ctx.gains.find((g) => g.gain.ramps.length > 0);
    expect(envelope?.gain.ramps).toEqual([[0, 10 + 30600 / 44100]]);
  });

  it("plays the wheel's squeak twice, as its LoopCount says", async () => {
    const { player, ctx } = await unlocked();
    player.consume([{ t: "sfx", id: "wheel", gain: 100, delayFrames: 1 }]);
    const [wheel] = started(ctx, "wheel");
    expect(wheel?.loop).toBe(true);
    expect(wheel?.stoppedAt).toBeCloseTo(10 + 1 / 19 + (2 * SOUNDS.wheel.samples) / 44100, 9);
  });

  it("loops the tumbling ball as one retrigger period", async () => {
    const { player, ctx } = await unlocked();
    player.consume([{ t: "sfx", id: "tumble", gain: 18, loop: true }]);
    const loop = ctx.sources.find((s) => s.loop && s.buffer !== null && sourceId(s) === null);
    expect(loop?.buffer?.duration).toBeCloseTo(Math.round((4 / 19) * 22050) / 22050, 9);
    player.consume([{ t: "sfxStop", id: "tumble" }]);
    expect(loop?.stoppedAt).toBe(-1);
  });
});
