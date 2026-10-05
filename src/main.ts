import { renderAchievements, wireAbout } from "@/app/about.ts";
import { hideBootPanel, setBootMessage, showFailure } from "@/app/bootPanel.ts";
import { versionLabel } from "@/app/build.ts";
import { pickRenderer, startAudioImport, startIntroImport, startPixiImport } from "@/app/chunks.ts";
import { wireControls } from "@/app/controls.ts";
import { dayKey } from "@/app/daily.ts";
import { fontsReady, loadFonts } from "@/app/fonts.ts";
import { FrameProfiler } from "@/app/FrameProfiler.ts";
import { rendererFromUrl } from "@/app/GameMode.ts";
import { applyPage, type InputDevice, pickLang, STRINGS, type Strings } from "@/app/i18n.ts";
import type { Intro } from "@/app/intro.ts";
import { wireLifecycle } from "@/app/lifecycle.ts";
import { MetaGame } from "@/app/MetaGame.ts";
import {
  instructionsFromUrl,
  profileWindowFromUrl,
  randomSeed,
  seedFromUrl,
  stressFromUrl,
} from "@/app/params.ts";
import { createPlay } from "@/app/play.ts";
import { browserStore } from "@/app/progress.ts";
import { resultsView, showShareLink } from "@/app/results.ts";
import { GameSession } from "@/app/session.ts";
import { browserShareEnv, shareLink } from "@/app/share.ts";
import { atlasUpgrade, loadAtlas, watchStageSize } from "@/app/stage.ts";
import { Toasts } from "@/app/toast.ts";
import type { LoadProgress } from "@/assets/AssetLoader.ts";
import { InputController } from "@/input/InputController.ts";
import { Effects } from "@/render/effects/Effects.ts";
import { elementScale } from "@/render/resolution.ts";
import { C } from "@/sim/constants.ts";
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

  // The last await. From here to the end boot runs in one go, so no handler
  // wired below can fire before `controls` and `play` exist.
  const introModule = await introImport;

  const haptics =
    touch && typeof navigator.vibrate === "function"
      ? (ms: number): void => {
          if (ms > 0 && !reducedMotion && meta.progress.settings.haptics) navigator.vibrate(ms);
        }
      : null;

  const changeLang = (value: string): void => {
    const choice = value === "en" || value === "de" ? value : null;
    meta.updateSettings({ lang: choice });
    lang = pickLang(null, choice, navigator.languages ?? []);
    t = STRINGS[lang];
    applyPage(document, lang);
    renderer.setStrings(t.hud);
    meta.setStrings(t);
    renderAchievements(t, meta.progress);
    controls.setStrings(t, play.current.paused);
    if (intro !== null && introModule !== null) {
      intro.setStrings(t, introModule.introModel(t, meta.mode, meta.progress, today()));
    }
  };
  const controls = wireControls({
    canvas,
    audio,
    strings: t,
    settings: () => meta.progress.settings,
    save: (change) => meta.updateSettings(change),
    onLanguage: changeLang,
    togglePause: () => input.togglePause(),
    touch,
    haptics: haptics !== null,
    signal,
  });

  input.attach(canvas, {
    onToggleHitboxes: () => renderer.toggleHitboxes(),
    onToggleMusic: controls.toggleMusic,
    onToggleSfx: controls.toggleSfx,
    // The button is out of the tab order like the other corners, so it gets a key too.
    onToggleFullscreen: () => controls.toggleFullscreen?.(),
    // Not over the opening screen, which has the same words and its own focus.
    onToggleInfo: () => {
      if (!(intro?.open ?? false)) about.toggle();
    },
  });
  signal.addEventListener("abort", () => input.detach());

  // The profiler wraps draw() from the outside, so neither backend can be
  // instrumented more kindly than the other.
  const profiler = params.has("profile")
    ? new FrameProfiler(`${backend} stress=${stress}`, profileWindowFromUrl(params))
    : null;
  // Scraping formatted console output is not reliable across drivers, so the
  // benchmark reads this instead.
  if (profiler !== null) window.__hamsterProfile = profiler;

  const play = createPlay({
    session,
    input,
    meta,
    effects,
    renderer,
    audio,
    haptics,
    profiler,
    pads,
    onTick: (s) => controls.syncPaused(s.paused),
    onError: () => fail(bootText.crashed),
  });

  const upgradeAtlas = atlasUpgrade(
    canvas,
    assets,
    (denser) => {
      renderer.setAssets(denser);
      intro?.setAssets(denser);
      if (!play.started) play.drawStill();
    },
    signal,
  );
  watchStageSize(
    canvas,
    () => {
      renderer.resize();
      // A resize clears the canvas. This runs as a frame callback queued
      // after the loop's own, so without drawing again here the stage stayed
      // cleared until the next frame - black for every frame of a window drag.
      play.redraw();
      upgradeAtlas();
    },
    signal,
  );
  // After `input.attach`: on a blur both let go of the button, and the
  // release has to reach the simulation before the pause does.
  about.onOpen = wireLifecycle({ play, input, audio, renderer, teardown });

  hideBootPanel();
  controls.reveal();
  const version = document.querySelector("#version");
  if (version !== null) version.textContent = versionLabel();
  const start = (): void => {
    controls.showPause();
    // Keyboard play works from the first keystroke, not the first click.
    canvas.focus({ preventScroll: true });
    // Nothing pressed before the game existed carries over into it.
    input.drain();
    meta.announce();
    play.start();
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
        play.restart(meta.nextSeed());
        leave();
      },
    });
    window.addEventListener("gamepadconnected", () => intro?.setDevice("pad"), { signal });
    intro.setAssets(assets);
    stageBox?.classList.add("intro-open");
    play.drawStill();
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
