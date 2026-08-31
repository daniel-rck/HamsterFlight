import { FixedTimestepLoop } from '@/app/FixedTimestepLoop.ts';
import { FrameProfiler } from '@/app/FrameProfiler.ts';
import { loadSprites } from '@/assets/AssetLoader.ts';
import { InputController } from '@/input/InputController.ts';
import { createCanvasRenderer } from '@/render/GameRenderer.ts';
import type { Renderer, RendererOptions } from '@/render/Renderer.ts';
import { Simulation } from '@/sim/index.ts';

function seedFromUrl(params: URLSearchParams): number {
  const raw = params.get('seed');
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed >>> 0;
  }
  // Real runs still differ; pass ?seed=... to reproduce one exactly.
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] ?? 1;
}

/**
 * `?renderer=pixi` swaps the backend. The Pixi module is imported dynamically
 * so it lands in its own Vite chunk: the default build's entry chunk stays free
 * of it, and one build yields both bundle numbers for the comparison.
 */
async function pickRenderer(
  name: string | null,
  canvas: HTMLCanvasElement,
  assets: Awaited<ReturnType<typeof loadSprites>>,
  options: RendererOptions,
): Promise<{ renderer: Renderer; backend: string }> {
  if (name === 'pixi') {
    const { createPixiRenderer } = await import('@/render/PixiRenderer.ts');
    return { renderer: await createPixiRenderer(canvas, assets, options), backend: 'pixi' };
  }
  return { renderer: await createCanvasRenderer(canvas, assets, options), backend: 'canvas2d' };
}

/** Renderer-only decoration multiplier; never touches the simulation. */
function stressFromUrl(params: URLSearchParams): number {
  const raw = params.get('stress');
  if (raw === null) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function setBootMessage(text: string): void {
  const boot = document.querySelector('#boot');
  if (boot !== null) boot.textContent = text;
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (canvas === null) throw new Error('#stage canvas missing');

  const params = new URLSearchParams(window.location.search);
  const seed = seedFromUrl(params);

  const assets = await loadSprites(({ loaded, total }) => {
    setBootMessage(`loading ${Math.round((loaded / total) * 100)}%`);
  });
  if (assets.missing.length > 0) {
    console.warn('[hamsterflight] %d sprite frames missing', assets.missing.length);
  }

  const sim = new Simulation({ seed });
  const stress = stressFromUrl(params);
  const { renderer, backend } = await pickRenderer(params.get('renderer'), canvas, assets, {
    showHitboxes: params.has('debug'),
    stress,
  });
  const input = new InputController();
  input.attach(canvas);

  // The profiler wraps draw() from the outside, so neither backend can be
  // instrumented more kindly than the other.
  const profileWindow = Number.parseInt(params.get('profileWindow') ?? '', 10);
  const profiler = params.has('profile')
    ? new FrameProfiler(
        `${backend} stress=${stress}`,
        Number.isFinite(profileWindow) && profileWindow > 0 ? profileWindow : 240,
      )
    : null;
  // Only under ?profile: lets scripts/bench-renderers.mjs read the windows as
  // data. Scraping formatted console output is not reliable across drivers.
  if (profiler !== null) {
    (window as unknown as { __hamsterProfile?: FrameProfiler }).__hamsterProfile = profiler;
  }

  const loop = new FixedTimestepLoop({
    step: () => {
      sim.step(input.drain());
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

  window.addEventListener('keydown', event => {
    if (event.key === 'h' || event.key === 'H') renderer.toggleHitboxes();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      loop.stop();
    } else {
      loop.resync();
      loop.start();
    }
  });

  document.querySelector('#boot')?.remove();
  loop.start();

  window.addEventListener('pagehide', () => renderer.destroy(), { once: true });

  console.info(
    '[hamsterflight] seed=%d renderer=%s - append ?seed=%d to replay',
    seed,
    backend,
    seed,
  );
}

boot().catch((error: unknown) => {
  console.error('[hamsterflight] boot failed', error);
  setBootMessage('failed to start - see the console');
});
