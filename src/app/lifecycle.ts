import type { Play } from "@/app/play.ts";
import type { AudioPlayer } from "@/audio/AudioPlayer.ts";
import type { InputController } from "@/input/InputController.ts";
import type { Renderer } from "@/render/Renderer.ts";

export interface LifecycleOptions {
  readonly play: Play;
  readonly input: Pick<InputController, "pause">;
  readonly audio: Pick<AudioPlayer, "setPaused"> | null;
  readonly renderer: Pick<Renderer, "destroy">;
  /** Everything boot listens to hangs off this; aborted when the page is discarded. */
  readonly teardown: AbortController;
}

/**
 * The game through the page's comings and goings: a blur, a hidden tab, the
 * back/forward cache. Returns the pause rule, which the help panel uses too.
 */
export function wireLifecycle(o: LifecycleOptions): () => void {
  const { play, input, audio, renderer, teardown } = o;
  const { signal } = teardown;

  // Coming back to a hamster already in free fall is no way to return to a
  // game, and a blur that does not hide the page - a notification shade, an
  // OS dialog, devtools - used to let the flight play out unattended. Only
  // while something is moving: the pad and the final score wait anyway. The
  // "paused" prompt then covers the way back.
  const pauseIfMoving = (): void => {
    const s = play.current;
    if (s.paused) return;
    if (s.phaseKind === "ready" || s.phaseKind === "gameOver") return;
    input.pause();
  };
  window.addEventListener("blur", pauseIfMoving, { signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        pauseIfMoving();
        play.stop();
        audio?.setPaused(true);
      } else {
        audio?.setPaused(play.current.paused);
        play.resume();
      }
    },
    { signal },
  );

  // `pagehide` also fires on the way into the back/forward cache, and a page
  // restored from there keeps running - so everything is only torn down when
  // the document is really being discarded.
  window.addEventListener(
    "pagehide",
    (event) => {
      play.stop();
      if (event.persisted) return;
      renderer.destroy();
      teardown.abort();
    },
    { signal },
  );
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) play.resume();
    },
    { signal },
  );
  return pauseIfMoving;
}
