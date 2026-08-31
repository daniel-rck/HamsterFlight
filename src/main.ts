import { FixedTimestepLoop } from '@/app/FixedTimestepLoop.ts';
import { loadSprites } from '@/assets/AssetLoader.ts';
import { InputController } from '@/input/InputController.ts';
import { GameRenderer } from '@/render/GameRenderer.ts';
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
  const renderer = new GameRenderer(canvas, assets, {
    showHitboxes: params.has('debug'),
  });
  const input = new InputController();
  input.attach(canvas);

  const loop = new FixedTimestepLoop({
    step: () => {
      sim.step(input.drain());
    },
    // Physics snaps at 20 Hz - the original stage ran at 19 fps with no
    // tweening - but sprite animation and the sky run on real time, so every
    // frame is drawn rather than only the stepped ones.
    draw: () => {
      renderer.draw(sim.snapshot(), performance.now());
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

  console.info('[hamsterflight] seed=%d - append ?seed=%d to replay', seed, seed);
}

boot().catch((error: unknown) => {
  console.error('[hamsterflight] boot failed', error);
  setBootMessage('failed to start - see the console');
});
