import { renderAchievements, wireAbout } from "@/app/about.ts";
import { hideBootPanel, setBootMessage, showFailure } from "@/app/bootPanel.ts";
import { versionLabel } from "@/app/build.ts";
import { pickRenderer, startAudioImport, startIntroImport, startPixiImport } from "@/app/chunks.ts";
import { dayKey } from "@/app/daily.ts";
import { FixedTimestepLoop } from "@/app/FixedTimestepLoop.ts";
import { fontsReady, loadFonts } from "@/app/fonts.ts";
import { FrameProfiler } from "@/app/FrameProfiler.ts";
import { rendererFromUrl } from "@/app/GameMode.ts";
import { vibrationFor } from "@/app/haptics.ts";
import { applyPage, type InputDevice, pickLang, STRINGS, type Strings } from "@/app/i18n.ts";
import type { Intro } from "@/app/intro.ts";
import { MetaGame } from "@/app/MetaGame.ts";
import {
  instructionsFromUrl,
  profileWindowFromUrl,
  randomSeed,
  seedFromUrl,
  stressFromUrl,
} from "@/app/params.ts";
import { browserStore, type Settings } from "@/app/progress.ts";
import { resultsView, showShareLink } from "@/app/results.ts";
import { GameSession } from "@/app/session.ts";
import { browserShareEnv, shareLink } from "@/app/share.ts";
import { atlasUpgrade, loadAtlas, watchStageSize } from "@/app/stage.ts";
import { Toasts } from "@/app/toast.ts";
import type { LoadProgress } from "@/assets/AssetLoader.ts";
import { InputController } from "@/input/InputController.ts";
import { Effects } from "@/render/effects/Effects.ts";
import { interpolate } from "@/render/interpolate.ts";
import { elementScale } from "@/render/resolution.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";
import { DEFAULT_TUNING } from "@/sim/tuning.ts";

/**
 * The words boot can say before - or without - a game: in the page's language
 * from the first message on, not only once the game is up. Replaced as soon as
 * the saved choice has been read.
 */
let bootText: Strings["boot"] = STRINGS.en.boot;

function fail(text: string): void {
  showFailure(text, bootText.reload);
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

  const scale = elementScale(canvas);
  // The HUD is canvas text, so the face is waited for - alongside the atlas,
  // not after it, and never for long: the fallback stack is a fine HUD too.
  const fonts = loadFonts();
  const pixiImport = startPixiImport(rendererName);
  const introImport = startIntroImport(instructionsFromUrl(params));
  const audioImport = startAudioImport();
  const progress = ({ fraction }: LoadProgress): void => {
    setBootMessage(
      fraction === null ? bootText.loading : bootText.loadingPercent(Math.round(fraction * 100)),
      fraction,
    );
  };
  const assets = await loadAtlas(scale, progress);
  if (assets === null) {
    fail(bootText.noArt);
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
      onProgress: (p) => renderAchievements(t, p),
    },
    opening.mode,
  );
  if (opening.badRun) {
    console.warn("[hamsterflight] ?run= could not be replayed; playing a free game");
    toasts.show(t.toast.badRun);
  }
  renderAchievements(t, meta.progress);
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
    renderAchievements(t, meta.progress);
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
      effects.follow(current, now);
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
    onError: () => fail(bootText.crashed),
  });

  // Until the opening screen is left the scene stands still behind it, as the
  // original's frame 6 had no Game yet: one picture, redrawn on every resize.
  let started = false;
  const drawStill = (): void => renderer.draw(current, performance.now(), meta.overlay(current, 1));
  const upgradeAtlas = atlasUpgrade(
    canvas,
    assets,
    (denser) => {
      renderer.setAssets(denser);
      intro?.setAssets(denser);
      if (!started) drawStill();
    },
    signal,
  );
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

  hideBootPanel();
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
  fail(bootText.noStart);
});
