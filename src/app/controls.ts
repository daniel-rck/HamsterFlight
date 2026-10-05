import type { Strings } from "@/app/i18n.ts";
import type { Settings } from "@/app/progress.ts";
import type { AudioPlayer } from "@/audio/AudioPlayer.ts";

export interface ControlsOptions {
  readonly canvas: HTMLCanvasElement;
  readonly audio: AudioPlayer | null;
  readonly strings: Strings;
  /** The saved settings as they are now; the panel shows them and writes through `save`. */
  readonly settings: () => Settings;
  readonly save: (change: Partial<Settings>) => void;
  /** A language select changed: "en", "de", or "" for the browser's own choice. */
  readonly onLanguage: (value: string) => void;
  readonly togglePause: () => void;
  /** The primary pointer is a finger: full screen also asks for landscape. */
  readonly touch: boolean;
  /** Whether this device can buzz at all; the haptics setting shows only then. */
  readonly haptics: boolean;
  readonly signal: AbortSignal;
}

export interface Controls {
  /** Music only, as the original's button was; not a saved setting. */
  readonly toggleMusic: () => void;
  readonly toggleSfx: () => void;
  /** Null where the page cannot go full screen - an iPhone's Safari has no element full screen. */
  readonly toggleFullscreen: (() => void) | null;
  /** The language changed: every label again, in the new words. */
  setStrings(t: Strings, paused: boolean): void;
  /** The pause button's look and label, touched only when the state changed. */
  syncPaused(paused: boolean, force?: boolean): void;
  /** Boot is done: the corner sound buttons show where there is sound to control. */
  reveal(): void;
  /** The game has started, so there is something to pause. */
  showPause(): void;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.querySelector<T>(`#${id}`);
}

/**
 * The page's own controls around the stage: music and sound, in the corner
 * and on the opening screen; pause; full screen; and the settings in the help
 * panel, which save as they change. Their labels follow the language and
 * their state follows the player and the game.
 */
export function wireControls(o: ControlsOptions): Controls {
  const { audio, signal, save } = o;
  let t = o.strings;
  const music = byId<HTMLButtonElement>("music");
  const sfx = byId<HTMLButtonElement>("sfx");
  const introMusic = byId<HTMLButtonElement>("intro-music");
  const introSfx = byId<HTMLButtonElement>("intro-sfx");
  const pause = byId<HTMLButtonElement>("pause");
  const fullscreen = byId<HTMLButtonElement>("fullscreen");
  const setSfx = byId<HTMLInputElement>("set-sfx");
  const setVolume = byId<HTMLInputElement>("set-volume");
  const setHaptics = byId<HTMLInputElement>("set-haptics");
  const setLang = byId<HTMLSelectElement>("set-lang");
  const introLang = byId<HTMLSelectElement>("intro-lang");

  const syncSound = (): void => {
    const musicMuted = audio?.musicMuted ?? false;
    const sfxMuted = audio?.sfxMuted ?? false;
    introMusic?.setAttribute("aria-pressed", String(!musicMuted));
    introSfx?.setAttribute("aria-pressed", String(!sfxMuted));
    music?.setAttribute("aria-pressed", String(musicMuted));
    music?.setAttribute("aria-label", musicMuted ? t.unmuteMusic : t.muteMusic);
    sfx?.setAttribute("aria-pressed", String(sfxMuted));
    sfx?.setAttribute("aria-label", sfxMuted ? t.unmuteSfx : t.muteSfx);
  };
  const syncSettings = (): void => {
    const settings = o.settings();
    if (setSfx !== null) setSfx.checked = !settings.sfxMuted;
    if (setVolume !== null) setVolume.value = String(Math.round(settings.volume * 100));
    if (setHaptics !== null) setHaptics.checked = settings.haptics;
    if (setLang !== null) setLang.value = settings.lang ?? "";
    if (introLang !== null) introLang.value = settings.lang ?? "";
  };
  const syncFullscreen = (): void => {
    fullscreen?.setAttribute(
      "aria-label",
      document.fullscreenElement === null ? t.fullscreen : t.exitFullscreen,
    );
  };
  let shownPaused: boolean | null = null;
  const syncPaused = (paused: boolean, force = false): void => {
    if (pause === null || (paused === shownPaused && !force)) return;
    shownPaused = paused;
    pause.dataset.paused = String(paused);
    pause.setAttribute("aria-label", paused ? t.resume : t.pause);
  };

  const toggleMusic = (): void => {
    if (audio === null) return;
    audio.toggleMusic();
    syncSound();
  };
  const toggleSfx = (): void => {
    if (audio === null) return;
    audio.setSfxMuted(!audio.sfxMuted);
    save({ sfxMuted: audio.sfxMuted });
    syncSound();
    syncSettings();
  };

  if (audio !== null) {
    // Audio may only start from a gesture. Any press on the page counts, and
    // the listeners go once the context is running.
    const unlock = (): void => audio.unlock();
    window.addEventListener("pointerdown", unlock, { signal, capture: true });
    window.addEventListener("keydown", unlock, { signal, capture: true });
  }
  for (const button of [music, sfx, pause]) {
    // Keep focus, and with it Space, on the canvas.
    button?.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
  }
  sfx?.addEventListener("click", toggleSfx, { signal });
  if (audio !== null) {
    music?.addEventListener("click", toggleMusic, { signal });
    introMusic?.addEventListener("click", toggleMusic, { signal });
    introSfx?.addEventListener("click", toggleSfx, { signal });
    if (introMusic !== null) introMusic.hidden = false;
    if (introSfx !== null) introSfx.hidden = false;
  }
  pause?.addEventListener("click", o.togglePause, { signal });

  // The settings in the help panel, which save as they change.
  syncSettings();
  if (audio !== null) {
    setSfx?.addEventListener(
      "change",
      () => {
        if (audio.sfxMuted === setSfx.checked) toggleSfx();
      },
      { signal },
    );
    setVolume?.addEventListener(
      "input",
      () => {
        const volume = Number(setVolume.value) / 100;
        audio.setVolume(volume);
        save({ volume });
      },
      { signal },
    );
  }
  const hapticsRow = byId("set-haptics-row");
  if (hapticsRow !== null) hapticsRow.hidden = !o.haptics;
  setHaptics?.addEventListener("change", () => save({ haptics: setHaptics.checked }), { signal });
  for (const select of [setLang, introLang]) {
    select?.addEventListener("change", () => o.onLanguage(select.value), { signal });
  }
  for (const id of ["settings", "achievements-panel"]) {
    const el = byId(id);
    if (el !== null) el.hidden = false;
  }

  // Full screen for the whole page, not the stage: the page already lays the
  // stage out at 3:2 in whatever it is given. Not offered where it cannot be had.
  let toggleFullscreen: (() => void) | null = null;
  if (fullscreen !== null && document.fullscreenEnabled === true) {
    const toggle = (): void => {
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
          return o.touch ? orientation.lock?.("landscape") : undefined;
        })
        .catch(() => undefined)
        .finally(() => o.canvas.focus({ preventScroll: true }));
    };
    fullscreen.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
    fullscreen.addEventListener("click", toggle, { signal });
    document.addEventListener("fullscreenchange", syncFullscreen, { signal });
    syncFullscreen();
    fullscreen.hidden = false;
    toggleFullscreen = toggle;
  }
  syncSound();

  return {
    toggleMusic,
    toggleSfx,
    toggleFullscreen,
    setStrings: (next, paused) => {
      t = next;
      syncSound();
      syncPaused(paused, true);
      syncFullscreen();
      syncSettings();
    },
    syncPaused,
    reveal: () => {
      if (audio === null) return;
      if (music !== null) music.hidden = false;
      if (sfx !== null) sfx.hidden = false;
    },
    showPause: () => {
      if (pause !== null) pause.hidden = false;
    },
  };
}
