import { versionLabel } from "@/app/build.ts";
import { FixedTimestepLoop } from "@/app/FixedTimestepLoop.ts";
import { FrameProfiler } from "@/app/FrameProfiler.ts";
import { modeFromUrl, type RendererName, rendererFromUrl } from "@/app/GameMode.ts";
import {
  instructionsFromUrl,
  profileWindowFromUrl,
  seedFromUrl,
  stressFromUrl,
} from "@/app/params.ts";
import { type AssetBundle, densityFor, loadSprites } from "@/assets/AssetLoader.ts";
import boardUrl from "@/assets/screens/instructions.webp?url";
import board2xUrl from "@/assets/screens/instructions@2x.webp?url";
import playOverUrl from "@/assets/screens/play-over.webp?url";
import playOver2xUrl from "@/assets/screens/play-over@2x.webp?url";
import playUpUrl from "@/assets/screens/play-up.webp?url";
import playUp2xUrl from "@/assets/screens/play-up@2x.webp?url";
import type { AudioPlayer } from "@/audio/AudioPlayer.ts";
import { InputController } from "@/input/InputController.ts";
import { Effects } from "@/render/effects/Effects.ts";
import { createCanvasRenderer } from "@/render/GameRenderer.ts";
import { interpolate } from "@/render/interpolate.ts";
import type { Renderer, RendererOptions } from "@/render/Renderer.ts";
import { stageScale } from "@/render/resolution.ts";
import { C } from "@/sim/constants.ts";
import { Simulation } from "@/sim/index.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";

/**
 * Whether this browser can give us a WebGL context at all. Asked on a scratch
 * canvas, because asking the stage canvas would claim its context type.
 */
function webglAvailable(): boolean {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
  // Browsers cap live contexts at a handful; the probe's would otherwise hold
  // one of those slots until it was garbage-collected.
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}

type PixiModule = typeof import("@/render/PixiRenderer.ts");

/** Root frame 6's art, at the density the page will show it at. */
function showInstructions(panel: HTMLElement, button: HTMLButtonElement): void {
  const board = panel.querySelector<HTMLImageElement>(":scope > img");
  const up = button.querySelector<HTMLImageElement>(".up");
  const over = button.querySelector<HTMLImageElement>(".over");
  const set = (img: HTMLImageElement | null, x1: string, x2: string): void => {
    if (img === null) return;
    img.src = x1;
    img.srcset = `${x1} 1x, ${x2} 2x`;
  };
  set(board, boardUrl, board2xUrl);
  set(up, playUpUrl, playUp2xUrl);
  set(over, playOverUrl, playOver2xUrl);
  panel.hidden = false;
}

/**
 * The player and its sound URLs, in a chunk of their own. A failure here is a
 * silent game, not a broken one, so it resolves to null instead of rejecting.
 */
function startAudioImport(): Promise<AudioPlayer | null> {
  return Promise.all([import("@/audio/AudioPlayer.ts"), import("@/assets/SoundUrls.ts")])
    .then(([{ AudioPlayer: Player }, { SOUND_URLS }]) => new Player({ urls: SOUND_URLS }))
    .catch((error: unknown) => {
      console.warn("[hamsterflight] no sound: %o", error);
      return null;
    });
}

/**
 * The Pixi module is imported dynamically so it lands in its own Vite chunk.
 * `?mode=faithful` then costs nothing beyond the entry chunk, and one build
 * still yields both bundle numbers for the comparison.
 *
 * Started here, before the atlas is awaited, so the two downloads overlap:
 * the chunk is 160 kB gzip and used to be requested only after the 2 MB sheet
 * had fully arrived. Resolves to null when Pixi is not wanted or the machine
 * cannot give it a context - a blocklisted GPU, WebGL disabled, a remote
 * desktop - and `pickRenderer` falls back to Canvas2D, which draws the same
 * scene without the shaders. Never rejects: the failure is reported there.
 */
function startPixiImport(name: RendererName): Promise<PixiModule | null> {
  if (name !== "pixi") return Promise.resolve(null);
  if (!webglAvailable()) {
    console.warn("[hamsterflight] no WebGL context available; using the canvas2d renderer");
    return Promise.resolve(null);
  }
  return import("@/render/PixiRenderer.ts").catch((error: unknown) => {
    console.warn("[hamsterflight] WebGL renderer failed to load; using canvas2d", error);
    return null;
  });
}

async function pickRenderer(
  pixi: PixiModule | null,
  canvas: HTMLCanvasElement,
  assets: AssetBundle,
  effects: Effects,
  options: RendererOptions,
): Promise<{ renderer: Renderer; backend: RendererName }> {
  if (pixi !== null) {
    try {
      return {
        renderer: await pixi.createPixiRenderer(canvas, assets, effects, options),
        backend: "pixi",
      };
    } catch (error) {
      console.warn("[hamsterflight] WebGL renderer failed to start; using canvas2d", error);
    }
  }
  return {
    renderer: await createCanvasRenderer(canvas, assets, effects, options),
    backend: "canvas2d",
  };
}

/**
 * The boot panel stays in the document, hidden, so a failure after boot has
 * somewhere to report itself. Removing it used to leave late errors invisible.
 */
function setBootMessage(text: string): void {
  const boot = document.querySelector<HTMLElement>("#boot");
  if (boot === null) return;
  boot.textContent = text;
  boot.hidden = false;
}

/**
 * A failure the player can do something about: say what happened in words
 * they can act on, and give them the one control that helps. "See the
 * console" was the whole message before, which meant nothing to a player.
 */
function showFailure(text: string): void {
  const boot = document.querySelector<HTMLElement>("#boot");
  if (boot === null) return;
  const message = document.createElement("p");
  message.textContent = text;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());
  boot.replaceChildren(message, reload);
  boot.hidden = false;
  reload.focus();
}

/**
 * Re-fit the backing store when the stage changes size - a window drag, a
 * scrollbar appearing, a monitor with a different pixel ratio. Coalesced into
 * one call per frame: every `resize()` reallocates the canvas, and a drag
 * fires dozens of events a second.
 */
function watchStageSize(
  canvas: HTMLCanvasElement,
  onChange: () => void,
  signal: AbortSignal,
): void {
  let pending = 0;
  const schedule = (): void => {
    if (pending !== 0) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      onChange();
    });
  };
  signal.addEventListener("abort", () => cancelAnimationFrame(pending));

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    signal.addEventListener("abort", () => observer.disconnect());
  } else {
    window.addEventListener("resize", schedule, { signal });
  }
  // A ratio change does not fire `resize`; ask the media query instead, and
  // re-arm it because the query is for the ratio we had, not the one we get.
  const watchRatio = (): void => {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      "change",
      () => {
        schedule();
        watchRatio();
      },
      { once: true, signal },
    );
  };
  if (typeof matchMedia === "function") watchRatio();
}

/**
 * Size the stage from what the page really has around it, not from an
 * estimate: the footer wraps to a different number of lines at every width.
 * `--chrome` is everything on the page that is not the stage; index.html
 * derives the stage's width from what it leaves of the viewport height.
 */
function fitStageToPage(signal: AbortSignal): void {
  if (typeof ResizeObserver !== "function") return;
  const around = [...document.body.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && !el.classList.contains("stage") && el.tagName !== "SCRIPT",
  );
  const measure = (): void => {
    const body = getComputedStyle(document.body);
    const padding = Number.parseFloat(body.paddingTop) + Number.parseFloat(body.paddingBottom);
    const gap = Number.parseFloat(body.rowGap) || 0;
    // A hidden row (the footer on a landscape phone) takes no gap either.
    let chrome = padding;
    for (const el of around) if (el.offsetHeight > 0) chrome += gap + el.offsetHeight;
    document.documentElement.style.setProperty("--chrome", `${Math.ceil(chrome)}px`);
  };
  measure();
  const observer = new ResizeObserver(measure);
  for (const el of around) observer.observe(el);
  signal.addEventListener("abort", () => observer.disconnect());
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (canvas === null) throw new Error("#stage canvas missing");
  // Everything boot() listens to hangs off this, so tearing the page down is
  // one call rather than a list of removeEventListener pairs to keep in step.
  const teardown = new AbortController();
  const { signal } = teardown;

  // Before the stage is measured below: the atlas density depends on its width.
  fitStageToPage(signal);

  const params = new URLSearchParams(window.location.search);
  const seed = seedFromUrl(params);
  const mode = modeFromUrl(params);
  const rendererName = rendererFromUrl(params, mode);

  // How big the stage actually is decides which atlas is worth downloading -
  // a 1x screen showing a wide layout is already past 1:1.
  const scale = stageScale(canvas.getBoundingClientRect().width, window.devicePixelRatio);
  const pixiImport = startPixiImport(rendererName);
  // Its own chunk: every visitor pays for the eager bundle, and nothing can
  // sound before the first gesture anyway.
  const audioImport = startAudioImport();
  const progress = ({ loaded, total }: { loaded: number; total: number }): void => {
    setBootMessage(total > 1 ? `loading ${Math.round((loaded / total) * 100)}%` : "loading…");
  };
  let assets = await loadSprites(progress, densityFor(scale));
  if (assets.missing.length > 0 && assets.density !== 1) {
    // The denser sheet is the larger download and the likelier one to fail;
    // the 1x sheet draws the same game, only softer.
    console.warn("[hamsterflight] %s; retrying at 1x", assets.missing.join(", "));
    assets = await loadSprites(progress, 1);
  }
  if (assets.missing.length > 0) {
    // One sheet holds every sprite, so a missing sheet is not a degraded game
    // but an invisible one: sky and HUD, no hamster, clicks that seem to do
    // nothing. Say so instead of starting it.
    console.error("[hamsterflight] sprite sheets missing: %s", assets.missing.join(", "));
    showFailure("Couldn't load the game art. Check your connection and reload.");
    return;
  }

  const sim = new Simulation({ seed, tuning: DEFAULT_TUNING });
  const stress = stressFromUrl(params);
  // Shake, warp and particles honour the OS-level preference; the rest of the
  // enhanced presentation - metres, the translucent bubble - is not motion.
  const reducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const effects = new Effects({
    enhanced: mode === "enhanced",
    motion: mode === "enhanced" && !reducedMotion,
  });
  const { renderer, backend } = await pickRenderer(await pixiImport, canvas, assets, effects, {
    showHitboxes: params.has("debug"),
    stress,
    tuning: DEFAULT_TUNING,
    touch: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
  });
  const audio = await audioImport;
  const musicButton = document.querySelector<HTMLButtonElement>("#music");
  const toggleMusic = (): void => {
    if (audio === null) return;
    const muted = audio.toggleMusic();
    musicButton?.setAttribute("aria-pressed", String(muted));
    musicButton?.setAttribute("aria-label", muted ? "Unmute music" : "Mute music");
  };
  if (audio !== null) {
    // Audio may only start from a gesture. Any press on the page counts, and
    // the listeners go once the context is running.
    const unlock = (): void => audio.unlock();
    window.addEventListener("pointerdown", unlock, { signal, capture: true });
    window.addEventListener("keydown", unlock, { signal, capture: true });
  }
  if (musicButton !== null && audio !== null) {
    musicButton.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
    musicButton.addEventListener("click", toggleMusic, { signal });
  }

  const input = new InputController();
  input.attach(canvas, {
    onToggleHitboxes: () => renderer.toggleHitboxes(),
    onToggleMusic: toggleMusic,
  });
  signal.addEventListener("abort", () => input.detach());

  const pauseButton = document.querySelector<HTMLButtonElement>("#pause");
  if (pauseButton !== null) {
    // Keep focus, and with it Space, on the canvas.
    pauseButton.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
    pauseButton.addEventListener("click", () => input.togglePause(), { signal });
  }
  let shownPaused: boolean | null = null;
  const syncPauseButton = (paused: boolean): void => {
    if (pauseButton === null || paused === shownPaused) return;
    shownPaused = paused;
    pauseButton.textContent = paused ? "\u25B6" : "II";
    pauseButton.setAttribute("aria-label", paused ? "Resume" : "Pause");
  };

  // The profiler wraps draw() from the outside, so neither backend can be
  // instrumented more kindly than the other.
  const profiler = params.has("profile")
    ? new FrameProfiler(`${mode}/${backend} stress=${stress}`, profileWindowFromUrl(params))
    : null;
  // Scraping formatted console output is not reliable across drivers, so the
  // benchmark reads this instead.
  if (profiler !== null) window.__hamsterProfile = profiler;

  // The snapshot is taken once per tick, here, and the draw reads it back:
  // both hooks used to build their own, twice the allocation for one picture.
  let previous: SimSnapshot | null = null;
  let current = sim.snapshot();

  const loop = new FixedTimestepLoop({
    step: () => {
      const commands = input.drain();
      // The event stream used to be discarded here. Impact clips ride on it.
      const events = sim.step(commands);
      const now = performance.now();
      previous = current;
      current = sim.snapshot();
      syncPauseButton(current.paused);
      effects.consume(events, now, current.hamster);
      if (audio !== null) {
        audio.setPaused(current.paused);
        audio.consume(events);
      }
      // Grit comes off whenever the hamster is dragging along the ground, not
      // only during the `skidding` predicate - that one is a two-tick window
      // and fires in 2 runs out of 40, which is not an effect anyone would see.
      const dragging =
        current.phaseKind === "flying" &&
        current.hamster.y >= C.SKID_Y &&
        Math.abs(current.hamster.xvel) > 2;
      if (dragging) effects.emitSkidDust(current.hamster.x, C.GROUND_Y, now);
    },
    // Physics snaps at 20 Hz; the picture does not. Every frame is drawn, with
    // the hamster and the camera placed between the last two ticks by how far
    // into the current tick the frame falls. The original stage ran at 19 fps
    // with no tweening, so this is a deliberate departure - presentation only,
    // the simulation and the scores are untouched.
    draw: (alpha) => {
      const now = performance.now();
      effects.prune(now);
      const snapshot = interpolate(previous, current, alpha);
      if (profiler === null) renderer.draw(snapshot, now);
      else profiler.measure(() => renderer.draw(snapshot, now));
    },
    // The loop stops and rethrows, so the stack still reaches the console;
    // without this the picture just froze.
    onError: () => showFailure("Something went wrong. Reload to play on."),
  });

  // Until Play Now! the scene stands still behind the board, as frame 6 has
  // no Game yet: one picture, redrawn whenever the stage is resized.
  let started = false;
  const drawStill = (): void => renderer.draw(current, performance.now());
  watchStageSize(
    canvas,
    () => {
      renderer.resize();
      if (!started) drawStill();
    },
    signal,
  );

  const resume = (): void => {
    if (!started) return;
    // Clips started before the tab went away would all expire at once, and
    // the renderer's animation clock must not count the time away either.
    effects.clear();
    renderer.resync();
    loop.start();
  };
  // Coming back to a hamster already in free fall is no way to return to a
  // game, and a blur that does not hide the page - a notification shade, an
  // OS dialog, devtools - used to let the flight play out unattended. Only
  // while something is moving: the pad and the final score wait anyway. The
  // "paused" prompt then covers the way back.
  const pauseIfMoving = (): void => {
    if (current.paused) return;
    if (current.phaseKind === "ready" || current.phaseKind === "gameOver") return;
    input.pause();
  };
  window.addEventListener("blur", pauseIfMoving, { signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        pauseIfMoving();
        loop.stop();
        audio?.setPaused(true);
      } else {
        audio?.setPaused(current.paused);
        resume();
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
      loop.stop();
      if (event.persisted) return;
      renderer.destroy();
      teardown.abort();
    },
    { signal },
  );
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) resume();
    },
    { signal },
  );

  const bootPanel = document.querySelector<HTMLElement>("#boot");
  if (bootPanel !== null) bootPanel.hidden = true;
  if (musicButton !== null && audio !== null) musicButton.hidden = false;
  const version = document.querySelector("#version");
  if (version !== null) version.textContent = versionLabel();
  const start = (): void => {
    started = true;
    if (pauseButton !== null) pauseButton.hidden = false;
    // Keyboard play works from the first keystroke, not the first click.
    canvas.focus({ preventScroll: true });
    // Nothing pressed before the game existed carries over into it.
    input.drain();
    loop.start();
  };
  const instructions = document.querySelector<HTMLElement>("#instructions");
  const playNow = document.querySelector<HTMLButtonElement>("#play-now");
  if (instructionsFromUrl(params) && instructions !== null && playNow !== null) {
    showInstructions(instructions, playNow);
    drawStill();
    playNow.focus({ preventScroll: true });
    // Button 503: `chalkboard_mc._visible = false; nextFrame()` - frame 7
    // builds the Game. Its `stopAllSounds()` has nothing to stop here: no
    // sound can have started before this click, which is also the one that
    // unlocks audio.
    playNow.addEventListener(
      "click",
      () => {
        instructions.hidden = true;
        audio?.unlock();
        start();
      },
      { signal, once: true },
    );
  } else {
    start();
  }

  console.info(
    "[hamsterflight] build=%s seed=%d mode=%s renderer=%s - append ?seed=%d to replay",
    versionLabel(),
    seed,
    mode,
    backend,
    seed,
  );
}

boot().catch((error: unknown) => {
  console.error("[hamsterflight] boot failed", error);
  showFailure("The game couldn't start in this browser. Reload to try again.");
});
