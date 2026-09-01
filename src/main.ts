import { versionLabel } from '@/app/build.ts';
import { FixedTimestepLoop } from '@/app/FixedTimestepLoop.ts';
import { FrameProfiler } from '@/app/FrameProfiler.ts';
import { modeFromUrl, type RendererName, rendererFromUrl } from '@/app/GameMode.ts';
import { profileWindowFromUrl, seedFromUrl, stressFromUrl } from '@/app/params.ts';
import { type AssetBundle, densityFor, loadSprites } from '@/assets/AssetLoader.ts';
import { InputController } from '@/input/InputController.ts';
import { Effects } from '@/render/effects/Effects.ts';
import { createCanvasRenderer } from '@/render/GameRenderer.ts';
import type { Renderer, RendererOptions } from '@/render/Renderer.ts';
import { stageScale } from '@/render/resolution.ts';
import { C } from '@/sim/constants.ts';
import { Simulation } from '@/sim/index.ts';

declare global {
  interface Window {
    /** Only under `?profile`: lets scripts/bench-renderers read the windows as data. */
    __hamsterProfile?: FrameProfiler;
  }
}

/**
 * Whether this browser can give us a WebGL context at all. Asked on a scratch
 * canvas, because asking the stage canvas would claim its context type.
 */
function webglAvailable(): boolean {
  const probe = document.createElement('canvas');
  return probe.getContext('webgl2') !== null || probe.getContext('webgl') !== null;
}

/**
 * The Pixi module is imported dynamically so it lands in its own Vite chunk.
 * `?mode=faithful` then costs nothing beyond the entry chunk, and one build
 * still yields both bundle numbers for the comparison.
 *
 * Pixi is the default for everyone, so a machine without WebGL - blocklisted
 * GPU, disabled in settings, a remote desktop - must not be a blank page. The
 * Canvas2D backend draws the same scene; it just cannot run the shaders.
 */
async function pickRenderer(
  name: RendererName,
  canvas: HTMLCanvasElement,
  assets: AssetBundle,
  effects: Effects,
  options: RendererOptions,
): Promise<{ renderer: Renderer; backend: RendererName }> {
  if (name === 'pixi') {
    if (!webglAvailable()) {
      console.warn('[hamsterflight] no WebGL context available; using the canvas2d renderer');
    } else {
      try {
        const { createPixiRenderer } = await import('@/render/PixiRenderer.ts');
        return {
          renderer: await createPixiRenderer(canvas, assets, effects, options),
          backend: 'pixi',
        };
      } catch (error) {
        console.warn('[hamsterflight] WebGL renderer failed to start; using canvas2d', error);
      }
    }
  }
  return {
    renderer: await createCanvasRenderer(canvas, assets, effects, options),
    backend: 'canvas2d',
  };
}

/**
 * The boot panel stays in the document, hidden, so a failure after boot has
 * somewhere to report itself. Removing it used to leave late errors invisible.
 */
function setBootMessage(text: string): void {
  const boot = document.querySelector<HTMLElement>('#boot');
  if (boot === null) return;
  boot.textContent = text;
  boot.hidden = false;
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (canvas === null) throw new Error('#stage canvas missing');

  const params = new URLSearchParams(window.location.search);
  const seed = seedFromUrl(params);
  const mode = modeFromUrl(params);
  const rendererName = rendererFromUrl(params, mode);

  // How big the stage actually is decides which atlas is worth downloading -
  // a 1x screen showing a wide layout is already past 1:1.
  const scale = stageScale(canvas.getBoundingClientRect().width, window.devicePixelRatio);
  const progress = ({ loaded, total }: { loaded: number; total: number }): void => {
    setBootMessage(total > 1 ? `loading ${Math.round((loaded / total) * 100)}%` : 'loading…');
  };
  let assets = await loadSprites(progress, densityFor(scale));
  if (assets.missing.length > 0 && assets.density !== 1) {
    // The denser sheet is the larger download and the likelier one to fail;
    // the 1x sheet draws the same game, only softer.
    console.warn('[hamsterflight] %s; retrying at 1x', assets.missing.join(', '));
    assets = await loadSprites(progress, 1);
  }
  if (assets.missing.length > 0) {
    console.error('[hamsterflight] sprite sheets missing: %s', assets.missing.join(', '));
  }

  const sim = new Simulation({ seed });
  const stress = stressFromUrl(params);
  const effects = new Effects({ enhanced: mode === 'enhanced' });
  const { renderer, backend } = await pickRenderer(rendererName, canvas, assets, effects, {
    showHitboxes: params.has('debug'),
    stress,
  });
  const input = new InputController();
  input.attach(canvas, { onToggleHitboxes: () => renderer.toggleHitboxes() });

  // The profiler wraps draw() from the outside, so neither backend can be
  // instrumented more kindly than the other.
  const profiler = params.has('profile')
    ? new FrameProfiler(`${mode}/${backend} stress=${stress}`, profileWindowFromUrl(params))
    : null;
  // Scraping formatted console output is not reliable across drivers, so the
  // benchmark reads this instead.
  if (profiler !== null) window.__hamsterProfile = profiler;

  const loop = new FixedTimestepLoop({
    step: () => {
      // The event stream used to be discarded here. Impact clips ride on it.
      const events = sim.step(input.drain());
      const now = performance.now();
      const snapshot = sim.snapshot();
      effects.consume(events, now, snapshot.hamster);
      // Grit comes off whenever the hamster is dragging along the ground, not
      // only during the `skidding` predicate - that one is a two-tick window
      // and fires in 2 runs out of 40, which is not an effect anyone would see.
      const dragging =
        snapshot.phaseKind === 'flying' &&
        snapshot.hamster.y >= C.SKID_Y &&
        Math.abs(snapshot.hamster.xvel) > 2;
      if (dragging) effects.emitSkidDust(snapshot.hamster.x, C.GROUND_Y, now);
    },
    // Physics snaps at 20 Hz - the original stage ran at 19 fps with no
    // tweening - but sprite animation and the sky run on real time, so every
    // frame is drawn rather than only the stepped ones.
    draw: () => {
      const snapshot = sim.snapshot();
      const now = performance.now();
      if (profiler === null) renderer.draw(snapshot, now);
      else profiler.measure(() => renderer.draw(snapshot, now));
    },
  });

  window.addEventListener('resize', () => renderer.resize());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      loop.stop();
    } else {
      // Clips started before the tab went away would all expire at once.
      effects.clear();
      loop.start();
    }
  });

  // `pagehide` also fires on the way into the back/forward cache, and a page
  // restored from there keeps running - so the renderer is only torn down
  // when the document is really being discarded.
  window.addEventListener('pagehide', event => {
    loop.stop();
    if (!event.persisted) renderer.destroy();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    effects.clear();
    loop.start();
  });

  const bootPanel = document.querySelector<HTMLElement>('#boot');
  if (bootPanel !== null) bootPanel.hidden = true;
  const version = document.querySelector('#version');
  if (version !== null) version.textContent = versionLabel();
  // Keyboard play works from the first keystroke, not the first click.
  canvas.focus({ preventScroll: true });
  loop.start();

  console.info(
    '[hamsterflight] build=%s seed=%d mode=%s renderer=%s - append ?seed=%d to replay',
    versionLabel(),
    seed,
    mode,
    backend,
    seed,
  );
}

boot().catch((error: unknown) => {
  console.error('[hamsterflight] boot failed', error);
  setBootMessage('failed to start - see the console');
});
