import { versionLabel } from '@/app/build.ts';
import { FixedTimestepLoop } from '@/app/FixedTimestepLoop.ts';
import { FrameProfiler } from '@/app/FrameProfiler.ts';
import { modeFromUrl, type RendererName, rendererFromUrl } from '@/app/GameMode.ts';
import { profileWindowFromUrl, seedFromUrl, stressFromUrl } from '@/app/params.ts';
import { type AssetBundle, densityFor, loadSprites } from '@/assets/AssetLoader.ts';
import { InputController } from '@/input/InputController.ts';
import { Effects } from '@/render/effects/Effects.ts';
import { createCanvasRenderer } from '@/render/GameRenderer.ts';
import { interpolate } from '@/render/interpolate.ts';
import type { Renderer, RendererOptions } from '@/render/Renderer.ts';
import { stageScale } from '@/render/resolution.ts';
import { C } from '@/sim/constants.ts';
import { Simulation } from '@/sim/index.ts';
import type { SimSnapshot } from '@/sim/state.ts';
import { DEFAULT_TUNING } from '@/sim/tuning.ts';

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
  signal.addEventListener('abort', () => cancelAnimationFrame(pending));

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    signal.addEventListener('abort', () => observer.disconnect());
  } else {
    window.addEventListener('resize', schedule, { signal });
  }
  // A ratio change does not fire `resize`; ask the media query instead, and
  // re-arm it because the query is for the ratio we had, not the one we get.
  const watchRatio = (): void => {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      'change',
      () => {
        schedule();
        watchRatio();
      },
      { once: true, signal },
    );
  };
  if (typeof matchMedia === 'function') watchRatio();
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (canvas === null) throw new Error('#stage canvas missing');
  // Everything boot() listens to hangs off this, so tearing the page down is
  // one call rather than a list of removeEventListener pairs to keep in step.
  const teardown = new AbortController();
  const { signal } = teardown;

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

  const sim = new Simulation({ seed, tuning: DEFAULT_TUNING });
  const stress = stressFromUrl(params);
  // Shake, warp and particles honour the OS-level preference; the rest of the
  // enhanced presentation - metres, the translucent bubble - is not motion.
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effects = new Effects({
    enhanced: mode === 'enhanced',
    motion: mode === 'enhanced' && !reducedMotion,
  });
  const { renderer, backend } = await pickRenderer(rendererName, canvas, assets, effects, {
    showHitboxes: params.has('debug'),
    stress,
    tuning: DEFAULT_TUNING,
  });
  const input = new InputController();
  input.attach(canvas, { onToggleHitboxes: () => renderer.toggleHitboxes() });
  signal.addEventListener('abort', () => input.detach());

  // The profiler wraps draw() from the outside, so neither backend can be
  // instrumented more kindly than the other.
  const profiler = params.has('profile')
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
      // The event stream used to be discarded here. Impact clips ride on it.
      const events = sim.step(input.drain());
      const now = performance.now();
      previous = current;
      current = sim.snapshot();
      effects.consume(events, now, current.hamster);
      // Grit comes off whenever the hamster is dragging along the ground, not
      // only during the `skidding` predicate - that one is a two-tick window
      // and fires in 2 runs out of 40, which is not an effect anyone would see.
      const dragging =
        current.phaseKind === 'flying' &&
        current.hamster.y >= C.SKID_Y &&
        Math.abs(current.hamster.xvel) > 2;
      if (dragging) effects.emitSkidDust(current.hamster.x, C.GROUND_Y, now);
    },
    // Physics snaps at 20 Hz; the picture does not. Every frame is drawn, with
    // the hamster and the camera placed between the last two ticks by how far
    // into the current tick the frame falls. The original stage ran at 19 fps
    // with no tweening, so this is a deliberate departure - presentation only,
    // the simulation and the scores are untouched.
    draw: alpha => {
      const now = performance.now();
      effects.prune(now);
      const snapshot = interpolate(previous, current, alpha);
      if (profiler === null) renderer.draw(snapshot, now);
      else profiler.measure(() => renderer.draw(snapshot, now));
    },
  });

  watchStageSize(canvas, () => renderer.resize(), signal);

  const resume = (): void => {
    // Clips started before the tab went away would all expire at once, and
    // the renderer's animation clock must not count the time away either.
    effects.clear();
    renderer.resync();
    loop.start();
  };
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) loop.stop();
      else resume();
    },
    { signal },
  );

  // `pagehide` also fires on the way into the back/forward cache, and a page
  // restored from there keeps running - so everything is only torn down when
  // the document is really being discarded.
  window.addEventListener(
    'pagehide',
    event => {
      loop.stop();
      if (event.persisted) return;
      renderer.destroy();
      teardown.abort();
    },
    { signal },
  );
  window.addEventListener(
    'pageshow',
    event => {
      if (event.persisted) resume();
    },
    { signal },
  );

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
