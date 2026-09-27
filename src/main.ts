import { versionLabel } from "@/app/build.ts";
import { dayKey } from "@/app/daily.ts";
import { FixedTimestepLoop } from "@/app/FixedTimestepLoop.ts";
import { FrameProfiler } from "@/app/FrameProfiler.ts";
import { type RendererName, rendererFromUrl } from "@/app/GameMode.ts";
import { vibrationFor } from "@/app/haptics.ts";
import { ACHIEVEMENT_IDS, applyPage, pickLang, STRINGS, type Strings } from "@/app/i18n.ts";
import { achievementCount, MetaGame } from "@/app/MetaGame.ts";
import {
  instructionsFromUrl,
  profileWindowFromUrl,
  randomSeed,
  seedFromUrl,
  stressFromUrl,
} from "@/app/params.ts";
import { browserStore, type Progress, type Settings } from "@/app/progress.ts";
import { resultsView } from "@/app/results.ts";
import { GameSession } from "@/app/session.ts";
import { Toasts } from "@/app/toast.ts";
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
 * The Pixi module is imported dynamically so it lands in its own Vite chunk:
 * the Canvas2D fallback then costs nothing beyond the entry chunk, and one
 * build still yields both bundle numbers for the comparison.
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
 * The help and credits, over the stage from the corner button. Wired before
 * anything loads, so they open even on a page whose game failed to start.
 * `onOpen` lets the game pause itself once it exists.
 */
function wireAbout(canvas: HTMLCanvasElement, signal: AbortSignal): { onOpen: () => void } {
  const hooks = { onOpen: (): void => {} };
  const button = document.querySelector<HTMLButtonElement>("#info");
  const about = document.querySelector<HTMLElement>("#about");
  if (button === null || about === null) return hooks;
  const show = (open: boolean): void => {
    about.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) hooks.onOpen();
    else canvas.focus({ preventScroll: true });
  };
  button.addEventListener("click", () => show(about.hasAttribute("hidden")), { signal });
  // Anywhere on the overlay closes it - it is information, not a dialog -
  // except the settings and the achievements, which are there to be used.
  about.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest("section") !== null) return;
      show(false);
    },
    { signal },
  );
  return hooks;
}

/** Today, locally - the daily challenge's day. */
function today(): string {
  return dayKey(new Date());
}

function pads(): readonly (Gamepad | null)[] {
  return typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (canvas === null) throw new Error("#stage canvas missing");
  // Everything boot() listens to hangs off this, so tearing the page down is
  // one call rather than a list of removeEventListener pairs to keep in step.
  const teardown = new AbortController();
  const { signal } = teardown;

  const about = wireAbout(canvas, signal);

  const params = new URLSearchParams(window.location.search);
  const rendererName = rendererFromUrl(params);

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

  const store = browserStore();
  const saved = store.load();
  let lang = pickLang(params.get("lang"), saved.settings.lang, navigator.languages ?? []);
  let t: Strings = STRINGS[lang];
  applyPage(document, lang);
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  const stress = stressFromUrl(params);
  // Shake, warp and particles honour the OS-level preference; the rest of the
  // presentation - the translucent bubble, the parallax sky - is not motion.
  const reducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const effects = new Effects({ motion: !reducedMotion });
  const { renderer, backend } = await pickRenderer(await pixiImport, canvas, assets, effects, {
    showHitboxes: params.has("debug"),
    stress,
    tuning: DEFAULT_TUNING,
    touch,
    strings: t.hud,
  });
  const audio = await audioImport;
  audio?.setVolume(saved.settings.volume);
  audio?.setSfxMuted(saved.settings.sfxMuted);
  const musicButton = document.querySelector<HTMLButtonElement>("#music");
  const sfxButton = document.querySelector<HTMLButtonElement>("#sfx");
  const syncSoundButtons = (): void => {
    const music = audio?.musicMuted ?? false;
    musicButton?.setAttribute("aria-pressed", String(music));
    musicButton?.setAttribute("aria-label", music ? t.unmuteMusic : t.muteMusic);
    const sfx = audio?.sfxMuted ?? false;
    sfxButton?.setAttribute("aria-pressed", String(sfx));
    sfxButton?.setAttribute("aria-label", sfx ? t.unmuteSfx : t.muteSfx);
  };
  const toggleMusic = (): void => {
    if (audio === null) return;
    audio.toggleMusic();
    syncSoundButtons();
  };
  if (audio !== null) {
    // Audio may only start from a gesture. Any press on the page counts, and
    // the listeners go once the context is running.
    const unlock = (): void => audio.unlock();
    window.addEventListener("pointerdown", unlock, { signal, capture: true });
    window.addEventListener("keydown", unlock, { signal, capture: true });
  }
  for (const button of [musicButton, sfxButton]) {
    // Keep focus, and with it Space, on the canvas.
    button?.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
  }
  if (musicButton !== null && audio !== null) {
    musicButton.addEventListener("click", toggleMusic, { signal });
  }

  const toasts = new Toasts(document.querySelector<HTMLElement>("#toast"));
  const input = new InputController();
  const renderAchievements = (p: Progress): void => {
    const list = document.querySelector<HTMLElement>("#achievements");
    const heading = document.querySelector<HTMLElement>("#achievements-count");
    if (list === null) return;
    list.replaceChildren(
      ...ACHIEVEMENT_IDS.map((id) => {
        const [title, detail] = t.achievements[id];
        const li = document.createElement("li");
        li.textContent = title;
        const small = document.createElement("small");
        small.textContent = detail;
        li.append(small);
        if (id in p.achievements) li.className = "done";
        return li;
      }),
    );
    const { done, of } = achievementCount(p);
    if (heading !== null) heading.textContent = `(${t.achievementsDone(done, of)})`;
  };
  // A shared run is replayed once, here: the seed and the ghost both come out of it.
  const opening = MetaGame.modeFor(params, saved, today());
  const meta = new MetaGame(
    {
      store,
      strings: t,
      toasts,
      today,
      randomSeed,
      celebrate: (x, y) => {
        effects.celebrate(x, y, performance.now());
        audio?.consume([{ t: "sfx", id: "pickup", gain: C.SFX_VOLUME }]);
      },
      share: async (url, text) => {
        try {
          if (typeof navigator.share === "function") {
            await navigator.share({ title: "HamsterFlight", text, url });
            return "shared";
          }
          await navigator.clipboard.writeText(url);
          return "copied";
        } catch (error) {
          // Cancelled by the player, or no clipboard: offer the link to copy by hand.
          if (error instanceof DOMException && error.name === "AbortError") return "failed";
          window.prompt(text, url);
          return "failed";
        }
      },
      baseUrl: () => `${window.location.origin}${window.location.pathname}`,
      results: resultsView(document.querySelector<HTMLElement>("#results"), {
        again: () => input.confirm(),
        switchMode: () => {
          meta.switchMode();
          input.confirm();
        },
        share: () => void meta.share(),
      }),
      onProgress: renderAchievements,
    },
    opening.mode,
  );
  if (opening.badRun) {
    console.warn("[hamsterflight] ?run= could not be replayed; playing a free game");
    toasts.show(t.toast.badRun);
  }
  renderAchievements(meta.progress);
  // A duel or a daily game plays its own seed; `?seed=` is for a free game.
  const seed = meta.mode.kind === "free" ? seedFromUrl(params) : meta.nextSeed();
  const session = new GameSession({
    seed,
    nextSeed: () => meta.nextSeed(),
    tuning: DEFAULT_TUNING,
  });

  const saveSettings = (change: Partial<Settings>): void => meta.updateSettings(change);
  const toggleSfx = (): void => {
    if (audio === null) return;
    audio.setSfxMuted(!audio.sfxMuted);
    saveSettings({ sfxMuted: audio.sfxMuted });
    syncSoundButtons();
    syncSettings();
  };
  sfxButton?.addEventListener("click", toggleSfx, { signal });

  const haptics =
    touch && !reducedMotion && typeof navigator.vibrate === "function"
      ? (ms: number): void => {
          if (ms > 0 && meta.progress.settings.haptics) navigator.vibrate(ms);
        }
      : null;

  // The settings in the help panel, which save as they change.
  const setSfx = document.querySelector<HTMLInputElement>("#set-sfx");
  const setVolume = document.querySelector<HTMLInputElement>("#set-volume");
  const setHaptics = document.querySelector<HTMLInputElement>("#set-haptics");
  const setLang = document.querySelector<HTMLSelectElement>("#set-lang");
  const syncSettings = (): void => {
    const settings = meta.progress.settings;
    if (setSfx !== null) setSfx.checked = !settings.sfxMuted;
    if (setVolume !== null) setVolume.value = String(Math.round(settings.volume * 100));
    if (setHaptics !== null) setHaptics.checked = settings.haptics;
    if (setLang !== null) setLang.value = settings.lang ?? "";
  };
  syncSettings();
  if (audio !== null) {
    setSfx?.addEventListener("change", () => {
      if (audio.sfxMuted === setSfx.checked) toggleSfx();
    });
    setVolume?.addEventListener("input", () => {
      const volume = Number(setVolume.value) / 100;
      audio.setVolume(volume);
      saveSettings({ volume });
    });
  }
  const hapticsRow = document.querySelector<HTMLElement>("#set-haptics-row");
  if (hapticsRow !== null) hapticsRow.hidden = haptics === null;
  setHaptics?.addEventListener("change", () => saveSettings({ haptics: setHaptics.checked }));
  setLang?.addEventListener("change", () => {
    const choice = setLang.value === "en" || setLang.value === "de" ? setLang.value : null;
    saveSettings({ lang: choice });
    lang = pickLang(null, choice, navigator.languages ?? []);
    t = STRINGS[lang];
    applyPage(document, lang);
    renderer.setStrings(t.hud);
    meta.setStrings(t);
    renderAchievements(meta.progress);
    syncSoundButtons();
    syncPauseButton(current.paused, true);
    syncFullscreenButton();
    syncSettings();
  });
  for (const section of ["#settings", "#achievements-panel"]) {
    const el = document.querySelector<HTMLElement>(section);
    if (el !== null) el.hidden = false;
  }

  input.attach(canvas, {
    onToggleHitboxes: () => renderer.toggleHitboxes(),
    onToggleMusic: toggleMusic,
    onToggleSfx: toggleSfx,
  });
  signal.addEventListener("abort", () => input.detach());

  const pauseButton = document.querySelector<HTMLButtonElement>("#pause");
  if (pauseButton !== null) {
    // Keep focus, and with it Space, on the canvas.
    pauseButton.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
    pauseButton.addEventListener("click", () => input.togglePause(), { signal });
  }
  let shownPaused: boolean | null = null;
  const syncPauseButton = (paused: boolean, force = false): void => {
    if (pauseButton === null || (paused === shownPaused && !force)) return;
    shownPaused = paused;
    pauseButton.textContent = paused ? "▶" : "II";
    pauseButton.setAttribute("aria-label", paused ? t.resume : t.pause);
  };

  // Full screen for the whole page, not the stage: the page already lays the
  // stage out at 3:2 in whatever it is given. Not offered where it cannot be
  // had - an iPhone's Safari has no element full screen.
  const fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen");
  const syncFullscreenButton = (): void => {
    fullscreenButton?.setAttribute(
      "aria-label",
      document.fullscreenElement === null ? t.fullscreen : t.exitFullscreen,
    );
  };
  if (fullscreenButton !== null && document.fullscreenEnabled === true) {
    fullscreenButton.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
    fullscreenButton.addEventListener(
      "click",
      () => {
        if (document.fullscreenElement !== null) {
          void document.exitFullscreen().catch(() => undefined);
          return;
        }
        void document.documentElement
          .requestFullscreen({ navigationUI: "hide" })
          .then(() => {
            // A phone held upright gets a third of the screen; ask for landscape.
            const orientation = screen.orientation as ScreenOrientation & {
              lock?: (o: string) => Promise<void>;
            };
            return touch ? orientation.lock?.("landscape") : undefined;
          })
          .catch(() => undefined)
          .finally(() => canvas.focus({ preventScroll: true }));
      },
      { signal },
    );
    document.addEventListener("fullscreenchange", syncFullscreenButton, { signal });
    syncFullscreenButton();
    fullscreenButton.hidden = false;
  }
  syncSoundButtons();

  // The profiler wraps draw() from the outside, so neither backend can be
  // instrumented more kindly than the other.
  const profiler = params.has("profile")
    ? new FrameProfiler(`${backend} stress=${stress}`, profileWindowFromUrl(params))
    : null;
  // Scraping formatted console output is not reliable across drivers, so the
  // benchmark reads this instead.
  if (profiler !== null) window.__hamsterProfile = profiler;

  // The snapshot is taken once per tick, here, and the draw reads it back:
  // both hooks used to build their own, twice the allocation for one picture.
  let previous: SimSnapshot | null = null;
  let current = session.snapshot;

  const loop = new FixedTimestepLoop({
    step: () => {
      const commands = input.drain();
      // The event stream used to be discarded here. Impact clips ride on it.
      const result = session.step(commands);
      const events = result.events;
      const now = performance.now();
      previous = result.restarted ? null : current;
      current = result.snapshot;
      syncPauseButton(current.paused);
      meta.step(result);
      effects.consume(events, now, current.hamster);
      if (audio !== null) {
        audio.setPaused(current.paused);
        audio.consume(events);
      }
      haptics?.(vibrationFor(events));
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
      // Every frame, not every tick: a quick tap must not fall between ticks.
      input.pollGamepads(pads());
      const now = performance.now();
      effects.prune(now);
      const snapshot = interpolate(previous, current, alpha);
      const overlay = meta.overlay(current, alpha);
      if (profiler === null) renderer.draw(snapshot, now, overlay);
      else profiler.measure(() => renderer.draw(snapshot, now, overlay));
    },
    // The loop stops and rethrows, so the stack still reaches the console;
    // without this the picture just froze.
    onError: () => showFailure("Something went wrong. Reload to play on."),
  });

  // Until Play Now! the scene stands still behind the board, as frame 6 has
  // no Game yet: one picture, redrawn whenever the stage is resized.
  let started = false;
  const drawStill = (): void => renderer.draw(current, performance.now(), meta.overlay(current, 1));
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
  about.onOpen = pauseIfMoving;
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
  if (audio !== null) {
    if (musicButton !== null) musicButton.hidden = false;
    if (sfxButton !== null) sfxButton.hidden = false;
  }
  const version = document.querySelector("#version");
  if (version !== null) version.textContent = versionLabel();
  const start = (): void => {
    started = true;
    if (pauseButton !== null) pauseButton.hidden = false;
    // Keyboard play works from the first keystroke, not the first click.
    canvas.focus({ preventScroll: true });
    // Nothing pressed before the game existed carries over into it.
    input.drain();
    meta.announce();
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
    meta.mode.kind,
    backend,
    seed,
  );
}

boot().catch((error: unknown) => {
  console.error("[hamsterflight] boot failed", error);
  showFailure("The game couldn't start in this browser. Reload to try again.");
});
