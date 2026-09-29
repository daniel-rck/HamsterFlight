import { versionLabel } from "@/app/build.ts";
import { dayKey } from "@/app/daily.ts";
import { FixedTimestepLoop } from "@/app/FixedTimestepLoop.ts";
import { fontsReady, loadFonts } from "@/app/fonts.ts";
import { FrameProfiler } from "@/app/FrameProfiler.ts";
import { type RendererName, rendererFromUrl } from "@/app/GameMode.ts";
import { vibrationFor } from "@/app/haptics.ts";
import {
  ACHIEVEMENT_IDS,
  applyPage,
  type InputDevice,
  pickLang,
  STRINGS,
  type Strings,
} from "@/app/i18n.ts";
import type { Intro } from "@/app/intro.ts";
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
import { browserShareEnv, shareLink } from "@/app/share.ts";
import { Toasts } from "@/app/toast.ts";
import {
  type AssetBundle,
  densityFor,
  type LoadProgress,
  loadSprites,
} from "@/assets/AssetLoader.ts";
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
 * The words boot can say before - or without - a game: in the page's language
 * from the first message on, not only once the game is up. Replaced as soon as
 * the saved choice has been read.
 */
let bootText: Strings["boot"] = STRINGS.en.boot;

/**
 * The boot panel stays in the document, hidden, so a failure after boot has
 * somewhere to report itself. Removing it used to leave late errors invisible.
 */
function setBootMessage(text: string, fraction: number | null = null): void {
  const boot = document.querySelector<HTMLElement>("#boot");
  if (boot === null) return;
  const line = boot.querySelector<HTMLElement>("#boot-text");
  if (line !== null) line.textContent = text;
  const bar = boot.querySelector<HTMLElement>(".boot-bar");
  if (bar !== null) {
    bar.toggleAttribute("data-known", fraction !== null);
    if (fraction !== null) bar.style.setProperty("--p", String(fraction));
  }
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
  message.setAttribute("role", "alert");
  message.textContent = text;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = bootText.reload;
  reload.addEventListener("click", () => window.location.reload());
  const logo = boot.querySelector(".boot-logo");
  boot.replaceChildren(...(logo === null ? [] : [logo]), message, reload);
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
 * The help and credits, over the stage from the corner button or `I`. Wired
 * before anything loads, so they open even on a page whose game failed to
 * start. `onOpen` lets the game pause itself once it exists.
 *
 * A dialog: focus moves in and comes back to the stage, Tab stays inside, and
 * Esc closes it - caught before the game's own Esc, which would pause.
 */
function wireAbout(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): { onOpen: () => void; toggle: () => void } {
  const hooks = { onOpen: (): void => {}, toggle: (): void => {} };
  const button = document.querySelector<HTMLButtonElement>("#info");
  const about = document.querySelector<HTMLElement>("#about");
  const card = about?.querySelector<HTMLElement>(":scope > div");
  if (button === null || about === null || card === null || card === undefined) return hooks;
  const show = (open: boolean): void => {
    about.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      hooks.onOpen();
      card.focus({ preventScroll: true });
    } else {
      canvas.focus({ preventScroll: true });
    }
  };
  hooks.toggle = () => show(about.hasAttribute("hidden"));
  button.addEventListener("click", hooks.toggle, { signal });
  about.querySelector("#about-close")?.addEventListener("click", () => show(false), { signal });
  // Anywhere on the overlay closes it - except the settings and the
  // achievements, which are there to be used.
  about.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest("section") !== null) return;
      show(false);
    },
    { signal },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (about.hasAttribute("hidden")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        show(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...card.querySelectorAll<HTMLElement>("button, input, select, [tabindex='0']"),
      ].filter((el) => el.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      const inside = card.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    },
    { signal, capture: true },
  );
  return hooks;
}

/**
 * The link, selected in a field on the results card, for when neither the
 * share sheet nor the clipboard would take it.
 */
function showShareLink(url: string): void {
  const field = document.querySelector<HTMLInputElement>("#results-link");
  if (field === null) return;
  field.value = url;
  field.hidden = false;
  field.focus({ preventScroll: true });
  field.select();
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

  const store = browserStore();
  const saved = store.load();
  let lang = pickLang(params.get("lang"), saved.settings.lang, navigator.languages ?? []);
  let t: Strings = STRINGS[lang];
  bootText = t.boot;
  applyPage(document, lang);

  // How big the stage actually is decides which atlas is worth downloading -
  // a 1x screen showing a wide layout is already past 1:1.
  const scale = stageScale(canvas.getBoundingClientRect().width, window.devicePixelRatio);
  // The HUD is canvas text, so the face is waited for - alongside the atlas,
  // not after it, and never for long: the fallback stack is a fine HUD too.
  const fonts = loadFonts();
  const pixiImport = startPixiImport(rendererName);
  // The opening screen is a chunk of its own, fetched alongside the atlas:
  // it is shown once per visit and never at all under `?instructions=0`.
  const introImport = instructionsFromUrl(params)
    ? import("@/app/intro.ts").catch((error: unknown) => {
        console.warn("[hamsterflight] no opening screen: %o", error);
        return null;
      })
    : Promise.resolve(null);
  // Its own chunk: every visitor pays for the eager bundle, and nothing can
  // sound before the first gesture anyway.
  const audioImport = startAudioImport();
  const progress = ({ fraction }: LoadProgress): void => {
    setBootMessage(
      fraction === null ? bootText.loading : bootText.loadingPercent(Math.round(fraction * 100)),
      fraction,
    );
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
    showFailure(bootText.noArt);
    return;
  }

  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  const stress = stressFromUrl(params);
  // Shake, warp and particles honour the OS-level preference; the rest of the
  // presentation - the translucent bubble, the parallax sky - is not motion.
  // The opening screen, built once the loop exists; settings and the motion
  // preference reach it through this.
  let intro: Intro | null = null;
  const motionQuery =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reducedMotion = motionQuery?.matches ?? false;
  const effects = new Effects({ motion: !reducedMotion });
  // The setting can change mid-game, from the OS or a browser's own toggle.
  motionQuery?.addEventListener(
    "change",
    () => {
      reducedMotion = motionQuery.matches;
      effects.motion = !reducedMotion;
      intro?.setMotion(!reducedMotion);
    },
    { signal },
  );
  const fontLoaded = await fonts;
  const { renderer, backend } = await pickRenderer(await pixiImport, canvas, assets, effects, {
    showHitboxes: params.has("debug"),
    stress,
    tuning: DEFAULT_TUNING,
    touch,
    strings: t.hud,
  });
  if (!fontLoaded) {
    // Arrived after the timeout: re-set the strings, which re-measures them
    // in the face that has now loaded.
    void fontsReady().then(() => renderer.setStrings(t.hud));
  }
  const audio = await audioImport;
  audio?.setVolume(saved.settings.volume);
  audio?.setSfxMuted(saved.settings.sfxMuted);
  const musicButton = document.querySelector<HTMLButtonElement>("#music");
  const sfxButton = document.querySelector<HTMLButtonElement>("#sfx");
  const introMusic = document.querySelector<HTMLButtonElement>("#intro-music");
  const introSfx = document.querySelector<HTMLButtonElement>("#intro-sfx");
  const syncSoundButtons = (): void => {
    const music = audio?.musicMuted ?? false;
    introMusic?.setAttribute("aria-pressed", String(!music));
    introSfx?.setAttribute("aria-pressed", String(!(audio?.sfxMuted ?? false)));
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
  if (audio !== null) {
    introMusic?.addEventListener("click", toggleMusic, { signal });
    if (introMusic !== null) introMusic.hidden = false;
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
        const outcome = await shareLink(browserShareEnv(), url, text);
        if (outcome === "manual") showShareLink(url);
        return outcome === "shared" || outcome === "copied" ? outcome : "failed";
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

  const introModule = await introImport;
  const saveSettings = (change: Partial<Settings>): void => meta.updateSettings(change);
  const toggleSfx = (): void => {
    if (audio === null) return;
    audio.setSfxMuted(!audio.sfxMuted);
    saveSettings({ sfxMuted: audio.sfxMuted });
    syncSoundButtons();
    syncSettings();
  };
  sfxButton?.addEventListener("click", toggleSfx, { signal });
  if (audio !== null) {
    introSfx?.addEventListener("click", toggleSfx, { signal });
    if (introSfx !== null) introSfx.hidden = false;
  }

  const haptics =
    touch && typeof navigator.vibrate === "function"
      ? (ms: number): void => {
          if (ms > 0 && !reducedMotion && meta.progress.settings.haptics) navigator.vibrate(ms);
        }
      : null;

  // The settings in the help panel, which save as they change.
  const setSfx = document.querySelector<HTMLInputElement>("#set-sfx");
  const setVolume = document.querySelector<HTMLInputElement>("#set-volume");
  const setHaptics = document.querySelector<HTMLInputElement>("#set-haptics");
  const setLang = document.querySelector<HTMLSelectElement>("#set-lang");
  const introLang = document.querySelector<HTMLSelectElement>("#intro-lang");
  const syncSettings = (): void => {
    const settings = meta.progress.settings;
    if (setSfx !== null) setSfx.checked = !settings.sfxMuted;
    if (setVolume !== null) setVolume.value = String(Math.round(settings.volume * 100));
    if (setHaptics !== null) setHaptics.checked = settings.haptics;
    if (setLang !== null) setLang.value = settings.lang ?? "";
    if (introLang !== null) introLang.value = settings.lang ?? "";
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
  const changeLang = (value: string): void => {
    const choice = value === "en" || value === "de" ? value : null;
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
    if (intro !== null && introModule !== null) {
      intro.setStrings(t, introModule.introModel(t, meta.mode, meta.progress, today()));
    }
  };
  for (const select of [setLang, introLang]) {
    select?.addEventListener("change", () => changeLang(select.value), { signal });
  }
  for (const section of ["#settings", "#achievements-panel"]) {
    const el = document.querySelector<HTMLElement>(section);
    if (el !== null) el.hidden = false;
  }

  // Set below, once it is known the browser can do it at all.
  let toggleFullscreen: (() => void) | null = null;
  input.attach(canvas, {
    onToggleHitboxes: () => renderer.toggleHitboxes(),
    onToggleMusic: toggleMusic,
    onToggleSfx: toggleSfx,
    // The button is out of the tab order like the other corners, so it gets a key too.
    onToggleFullscreen: () => toggleFullscreen?.(),
    // Not over the opening screen, which has the same words and its own focus.
    onToggleInfo: () => {
      if (!(intro?.open ?? false)) about.toggle();
    },
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
    pauseButton.dataset.paused = String(paused);
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
    toggleFullscreen = (): void => {
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
    };
    fullscreenButton.addEventListener("click", toggleFullscreen, { signal });
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
      if (current.phaseKind === "flying" && current.hamster.visible) {
        effects.noteFlight(
          current.hamster.x,
          current.hamster.y,
          current.hamster.xvel,
          current.hamster.yvel,
        );
      } else {
        effects.endFlight();
      }
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
    onError: () => showFailure(bootText.crashed),
  });

  // Until the opening screen is left the scene stands still behind it, as the
  // original's frame 6 had no Game yet: one picture, redrawn on every resize.
  let started = false;
  const drawStill = (): void => renderer.draw(current, performance.now(), meta.overlay(current, 1));
  // The atlas was picked for the stage as it was at boot. A stage that grows
  // past it - full screen, a larger window, a sharper monitor - fetches the
  // denser sheet once, in the background, and swaps it in; a failure keeps
  // the softer one, which draws the same game.
  let upgrading = false;
  const upgradeAtlas = (): void => {
    const wanted = densityFor(
      stageScale(canvas.getBoundingClientRect().width, window.devicePixelRatio),
    );
    if (upgrading || wanted <= assets.density) return;
    upgrading = true;
    void loadSprites(undefined, wanted).then((denser) => {
      if (signal.aborted) return;
      if (denser.missing.length > 0) {
        console.warn("[hamsterflight] denser atlas unavailable: %s", denser.missing.join(", "));
        return;
      }
      assets = denser;
      renderer.setAssets(denser);
      intro?.setAssets(denser);
      if (!started) drawStill();
      upgrading = false;
    });
  };
  watchStageSize(
    canvas,
    () => {
      renderer.resize();
      if (!started) drawStill();
      upgradeAtlas();
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
  const introRoot = document.querySelector<HTMLElement>("#intro");
  const stageBox = canvas.parentElement;
  if (introModule !== null && introRoot !== null) {
    const device = (): InputDevice =>
      pads().some((pad) => pad !== null) ? "pad" : touch ? "touch" : "mouse";
    const leave = (): void => {
      intro?.hide();
      stageBox?.classList.remove("intro-open");
      audio?.unlock();
      start();
    };
    intro = new introModule.Intro({
      root: introRoot,
      strings: t,
      device: device(),
      motion: !reducedMotion,
      signal,
      onPlay: leave,
      onSecondary: () => {
        // The other mode, and a game built for it: the session was seeded
        // for the one the page opened in.
        meta.switchMode();
        session.reset(meta.nextSeed());
        previous = null;
        current = session.snapshot;
        leave();
      },
    });
    window.addEventListener("gamepadconnected", () => intro?.setDevice("pad"), { signal });
    intro.setAssets(assets);
    stageBox?.classList.add("intro-open");
    drawStill();
    intro.show(introModule.introModel(t, meta.mode, meta.progress, today()));
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
  showFailure(bootText.noStart);
});
