import { FixedTimestepLoop } from '@/app/FixedTimestepLoop.ts';
import { InputController } from '@/input/InputController.ts';
import { DebugRenderer } from '@/render/DebugRenderer.ts';
import { Simulation } from '@/sim/index.ts';

function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed >>> 0;
  }
  // Real runs still differ; pass ?seed=... to reproduce one exactly.
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] ?? 1;
}

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  if (canvas === null) throw new Error('#stage canvas missing');

  const seed = seedFromUrl();
  const sim = new Simulation({ seed });
  const renderer = new DebugRenderer(canvas);
  const input = new InputController();
  input.attach(canvas);

  const loop = new FixedTimestepLoop({
    step: () => {
      sim.step(input.drain());
    },
    draw: (_alpha, stepped) => {
      // Snap rather than interpolate: the original's stage ran at 19 fps with
      // no tweening, so snapping is the faithful look - and it means ~20 draws
      // per second instead of 60.
      if (stepped) renderer.draw(sim.snapshot());
    },
  });

  window.addEventListener('resize', () => {
    renderer.resize();
    renderer.draw(sim.snapshot());
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
  renderer.draw(sim.snapshot());
  loop.start();

  // Handy when reproducing a run from a golden test.
  console.info('[hamsterflight] seed=%d - append ?seed=%d to replay', seed, seed);
}

boot();
