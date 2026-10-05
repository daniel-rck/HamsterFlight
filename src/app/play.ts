import { FixedTimestepLoop, type LoopClock } from "@/app/FixedTimestepLoop.ts";
import type { FrameProfiler } from "@/app/FrameProfiler.ts";
import { vibrationFor } from "@/app/haptics.ts";
import type { MetaGame } from "@/app/MetaGame.ts";
import type { GameSession } from "@/app/session.ts";
import type { AudioPlayer } from "@/audio/AudioPlayer.ts";
import type { InputController } from "@/input/InputController.ts";
import type { Effects } from "@/render/effects/Effects.ts";
import { interpolate } from "@/render/interpolate.ts";
import type { Renderer } from "@/render/Renderer.ts";
import type { SimSnapshot } from "@/sim/state.ts";

export interface PlayOptions {
  readonly session: GameSession;
  readonly input: Pick<InputController, "drain" | "pollGamepads">;
  readonly meta: Pick<MetaGame, "step" | "overlay">;
  readonly effects: Effects;
  readonly renderer: Pick<Renderer, "draw" | "resync">;
  readonly audio: Pick<AudioPlayer, "setPaused" | "consume"> | null;
  /** Buzzes for one tick's events; null where the device cannot or should not. */
  readonly haptics: ((ms: number) => void) | null;
  /** Wraps every draw when `?profile` asked for one. */
  readonly profiler: FrameProfiler | null;
  readonly pads: () => readonly (Gamepad | null)[];
  /** After every tick, with its snapshot - the pause button follows it. */
  readonly onTick: (s: SimSnapshot) => void;
  /** The loop stopped on an error, which it rethrows after this. */
  readonly onError: () => void;
  /** Wall-clock milliseconds, for everything that animates; `performance.now` by default. */
  readonly now?: () => number;
  /** The loop's frame scheduler, for tests; the browser's by default. */
  readonly clock?: LoopClock;
}

export interface Play {
  /** The newest tick's snapshot. */
  readonly current: SimSnapshot;
  /** Whether the opening screen has been left and the loop has run. */
  readonly started: boolean;
  start(): void;
  stop(): void;
  /**
   * Back from a hidden tab or the back/forward cache. Clips started before
   * the page went away would all expire at once, and the renderer's animation
   * clock must not count the time away either. Nothing to resume before the
   * game has started.
   */
  resume(): void;
  /** A fresh game on `seed`, before the loop has started - the opening screen's other mode. */
  restart(seed: number): void;
  /**
   * Until the opening screen is left the scene stands still behind it, as
   * the original's frame 6 had no Game yet: one picture, redrawn on demand.
   */
  drawStill(): void;
}

/**
 * The game as it runs: the fixed-step loop, the two snapshots it draws
 * between, and everything one tick hands on - the page's game around the
 * game, the effects, the sound and the buzz. It owns no DOM; boot wires it to
 * the page.
 */
export function createPlay(o: PlayOptions): Play {
  const { session, input, meta, effects, renderer, audio, haptics, profiler } = o;
  const now = o.now ?? (() => performance.now());
  // The snapshot is taken once per tick, in the step, and the draw reads it
  // back: both hooks used to build their own, twice the allocation for one picture.
  let previous: SimSnapshot | null = null;
  let current = session.snapshot;
  let started = false;

  const loop = new FixedTimestepLoop(
    {
      step: () => {
        // The event stream used to be discarded here. Impact clips ride on it.
        const result = session.step(input.drain());
        const events = result.events;
        const at = now();
        previous = result.restarted ? null : current;
        current = result.snapshot;
        o.onTick(current);
        meta.step(result);
        effects.consume(events, at, current.hamster);
        if (audio !== null) {
          audio.setPaused(current.paused);
          audio.consume(events);
        }
        haptics?.(vibrationFor(events));
        effects.follow(current, at);
      },
      // Physics snaps at 20 Hz; the picture does not. Every frame is drawn,
      // with the hamster and the camera placed between the last two ticks by
      // how far into the current tick the frame falls. The original stage ran
      // at 19 fps with no tweening, so this is a deliberate departure -
      // presentation only, the simulation and the scores are untouched.
      draw: (alpha) => {
        // Every frame, not every tick: a quick tap must not fall between ticks.
        input.pollGamepads(o.pads());
        const at = now();
        effects.prune(at);
        const snapshot = interpolate(previous, current, alpha);
        const overlay = meta.overlay(current, alpha);
        if (profiler === null) renderer.draw(snapshot, at, overlay);
        else profiler.measure(() => renderer.draw(snapshot, at, overlay));
      },
      // The loop stops and rethrows, so the stack still reaches the console;
      // without this the picture just froze.
      onError: o.onError,
    },
    o.clock,
  );

  return {
    get current() {
      return current;
    },
    get started() {
      return started;
    },
    start: () => {
      started = true;
      loop.start();
    },
    stop: () => loop.stop(),
    resume: () => {
      if (!started) return;
      effects.clear();
      renderer.resync();
      loop.start();
    },
    restart: (seed) => {
      session.reset(seed);
      previous = null;
      current = session.snapshot;
    },
    drawStill: () => renderer.draw(current, now(), meta.overlay(current, 1)),
  };
}
