#!/usr/bin/env node
// Does the game actually come up and draw, in every mode and on both backends?
//
//   npm run build && npm run smoke
//
// This exists because of a bug the rest of the suite structurally cannot see.
// The scene shader did not link on its first build - `uInputSize` was declared
// at a different precision in the vertex and fragment stages - and neither the
// typecheck nor a single unit test had anything to say about it, because the
// failure happens inside a GPU driver at run time. It was found by opening the
// page. This opens the page.
//
// Four combinations, because the two axes are independent: `enhanced` and
// `faithful` differ in what they draw, `pixi` and `canvas2d` in how.
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChromium, playOneShot, startServer, waitForBoot } from './lib/preview.mjs';

const PORT = 4174;
const SEED = Number(process.env.SEED ?? 12345);
const COMBINATIONS = [
  { mode: 'enhanced', renderer: 'pixi' },
  { mode: 'enhanced', renderer: 'canvas2d' },
  { mode: 'faithful', renderer: 'canvas2d' },
  { mode: 'faithful', renderer: 'pixi' },
];

/**
 * How many distinct colours the stage is showing.
 *
 * The liveness test, and deliberately the weakest claim that still means
 * something: a page that boots, throws nothing and renders a flat void would
 * pass a pure "no errors" smoke test. Asking for a specific colour at a
 * specific place would be the other failure mode - colour probing produced
 * three false positives while the effects layer was being built - so this only
 * ever asks whether *anything* was drawn.
 *
 * The pixels come from a screenshot rather than from the canvas directly.
 * Reading a WebGL canvas with `drawImage` outside its own rendering frame
 * returns a cleared buffer, because Pixi - rightly - does not pay for
 * `preserveDrawingBuffer`; the first version of this check read one colour off
 * both Pixi runs and passed both Canvas2D ones. A screenshot goes through the
 * compositor, so it sees what a person sees, on either backend.
 */
async function distinctColours(page) {
  const shot = await page.locator('#stage').screenshot({ type: 'png' });
  return page.evaluate(
    async source => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const scaled = document.createElement('canvas');
      scaled.width = 40;
      scaled.height = 30;
      const ctx = scaled.getContext('2d');
      if (ctx === null) return 0;
      ctx.drawImage(image, 0, 0, scaled.width, scaled.height);
      const { data } = ctx.getImageData(0, 0, scaled.width, scaled.height);
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) {
        seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      }
      return seen.size;
    },
    `data:image/png;base64,${shot.toString('base64')}`,
  );
}

/** Enough that a sky gradient alone would clear it, far short of a real frame. */
const MIN_COLOURS = 8;

async function check(browser, origin, { mode, renderer }) {
  const label = `${mode}/${renderer}`;
  const failures = [];
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  // Both channels: an unhandled throw and a logged error are different events,
  // and a failed shader link surfaces as the second one.
  page.on('pageerror', error => failures.push(`uncaught: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console.error: ${message.text()}`);
  });

  try {
    // `?profile` is what publishes the frame counter on window.
    await page.goto(`${origin}/?seed=${SEED}&profile&mode=${mode}&renderer=${renderer}`, {
      waitUntil: 'load',
    });
    await waitForBoot(page);
  } catch (error) {
    failures.push(`never finished booting: ${error.message}`);
    await page.close();
    return { label, failures };
  }

  await playOneShot(page);
  // The page renders on demand rather than every animation frame, so give the
  // last of the shot's frames a moment to land before reading the counter.
  await sleep(200);

  const frames = await page.evaluate(() => window.__hamsterProfile?.framesSeen ?? 0);
  if (frames === 0) failures.push('booted and played a shot but drew no frames');

  const colours = await distinctColours(page);
  if (colours < MIN_COLOURS) {
    failures.push(`canvas has ${colours} distinct colour(s) - nothing was drawn`);
  }

  // The build stamp is substituted at build time, so an empty slot means the
  // define never fired - and the deployed page could not be identified.
  const version = await page.evaluate(() => document.querySelector('#version')?.textContent ?? '');
  if (version.trim() === '') failures.push('the build stamp is empty');

  await page.close();
  return { label, failures, frames, colours, version };
}

async function main() {
  const { origin, stop } = await startServer(PORT);
  const browser = await launchChromium();
  const results = [];
  try {
    for (const combination of COMBINATIONS) {
      process.stderr.write(`checking ${combination.mode}/${combination.renderer}...\n`);
      results.push(await check(browser, origin, combination));
    }
  } finally {
    await browser.close();
    stop();
  }

  console.log(`\nbuild ${results.find(result => result.version)?.version ?? '(none)'}`);
  for (const result of results) {
    const ok = result.failures.length === 0;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${result.label.padEnd(20)}` +
        (ok ? `${result.frames} frames, ${result.colours} colours` : ''),
    );
    for (const failure of result.failures) console.error(`        ${failure}`);
  }

  const failed = results.filter(result => result.failures.length > 0);
  if (failed.length > 0) {
    console.error(`\n${failed.length} of ${results.length} combinations failed.`);
    process.exitCode = 1;
  }
}

await main();
