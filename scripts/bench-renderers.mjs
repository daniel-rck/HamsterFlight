#!/usr/bin/env node
// Drives both renderer backends through the same scripted flight and collects
// the FrameProfiler windows, so the PixiJS evaluation rests on measurements
// rather than on argument.
//
//   npm run build && npm run bench:renderers
//
// IMPORTANT - read the numbers with the reported GPU in mind. Under a software
// rasteriser (headless CI, a container with no /dev/dri) WebGL is emulated on
// the CPU and Pixi is heavily penalised for reasons that have nothing to do
// with its design. Only a run on real hardware settles the question; this
// harness exists so that run is one command.
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChromium, playOneShot, startServer, waitForBoot } from './lib/preview.mjs';

const PORT = 4173;
const SEED = Number(process.env.SEED ?? 12345);
// Small enough that even the heaviest stress level closes several windows
// inside RUN_MS, large enough for a stable p50.
const WINDOW = Number(process.env.WINDOW ?? 40);
const RUN_MS = Number(process.env.RUN_MS ?? 16000);
const BACKENDS = ['canvas2d', 'pixi'];
const STRESS = process.env.STRESS?.split(',').map(Number) ?? [1, 4, 16, 64];

/**
 * Shot after shot, so the page keeps producing flight frames for the whole
 * measurement window rather than sitting on the launcher between runs.
 */
async function flyRepeatedly(page, signal) {
  while (!signal.done) {
    try {
      await playOneShot(page);
      await sleep(2300);
    } catch {
      return;
    }
  }
}

async function measure(browser, origin, backend, stress) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  let gpu = null;
  page.on('pageerror', error => process.stderr.write(`  page error: ${error.message}\n`));

  const query = `?seed=${SEED}&profile&profileWindow=${WINDOW}&stress=${stress}${
    backend === 'pixi' ? '&renderer=pixi' : ''
  }`;
  await page.goto(origin + query, { waitUntil: 'load' });
  await waitForBoot(page);

  gpu = await page.evaluate(() => {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (probe === null) return 'no webgl2';
    const info = probe.getExtension('WEBGL_debug_renderer_info');
    return info === null ? 'unknown' : String(probe.getParameter(info.UNMASKED_RENDERER_WEBGL));
  });

  const signal = { done: false };
  const flying = flyRepeatedly(page, signal);
  await sleep(RUN_MS);
  signal.done = true;
  await flying;

  // Read the windows as data. main.ts publishes the profiler on window under
  // ?profile precisely so this does not have to parse console formatting.
  const { windows, frames } = await page.evaluate(() => {
    const profiler = window.__hamsterProfile;
    return profiler === undefined
      ? { windows: [], frames: 0 }
      : {
          windows: profiler.reports.map(r => ({ p50: r.p50, p95: r.p95, max: r.max })),
          frames: profiler.framesSeen,
        };
  });
  await page.close();

  return { backend, stress, windows, frames, gpu };
}

function median(values) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const { server, origin } = await startServer(PORT);
  const browser = await launchChromium();
  const results = [];
  try {
    for (const stress of STRESS) {
      for (const backend of BACKENDS) {
        process.stderr.write(`measuring ${backend} stress=${stress}...\n`);
        results.push(await measure(browser, origin, backend, stress));
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  const gpu = results.find(row => row.gpu && row.gpu !== 'unknown')?.gpu ?? 'unknown';
  console.log(`\nGPU: ${gpu}`);
  console.log(`seed=${SEED}  window=${WINDOW} frames  ${RUN_MS / 1000}s per configuration\n`);
  console.log('backend    stress   frames   p50 ms   p95 ms   max ms   fps');
  console.log('-'.repeat(62));
  for (const row of results) {
    const cell = value => (Number.isNaN(value) ? '      -' : value.toFixed(3).padStart(7));
    const fps = row.frames / (RUN_MS / 1000);
    console.log(
      `${row.backend.padEnd(10)} ${String(row.stress).padStart(6)}  ${String(row.frames).padStart(7)}  ` +
        `${cell(median(row.windows.map(w => w.p50)))}  ${cell(median(row.windows.map(w => w.p95)))}  ` +
        `${cell(median(row.windows.map(w => w.max)))}  ${fps.toFixed(1).padStart(5)}`,
    );
  }
  console.log(
    '\nValues are the median across measurement windows; the first window of each\n' +
      'run is discarded as warmup.',
  );
}

await main();
