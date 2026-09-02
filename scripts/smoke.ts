// Does the game actually come up and draw, in every mode and on both backends?
//
//   bun run build && bun run smoke
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
import type { Browser, Page } from 'playwright';
import { intEnv, run } from './lib/cli.ts';
import {
  launchChromium,
  playOneShot,
  startServer,
  waitForBoot,
  watchRequests,
} from './lib/preview.ts';

const PORT = intEnv('PORT', 4174);
const SEED = intEnv('SEED', 12345);
const COMBINATIONS = [
  { mode: 'enhanced', renderer: 'pixi' },
  { mode: 'enhanced', renderer: 'canvas2d' },
  { mode: 'faithful', renderer: 'canvas2d' },
  { mode: 'faithful', renderer: 'pixi' },
] as const;

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
async function distinctColours(page: Page): Promise<number> {
  const shot = await page.locator('#stage').screenshot({ type: 'png' });
  return page.evaluate(
    async (source: string) => {
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
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
      }
      return seen.size;
    },
    `data:image/png;base64,${shot.toString('base64')}`,
  );
}

/** Enough that a sky gradient alone would clear it, far short of a real frame. */
const MIN_COLOURS = 8;

/**
 * What the page looks like right now, for a failure whose cause is not in its
 * own message. Guarded, because the usual reason to be asking is that the page
 * is no longer answering at all.
 */
async function describe(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const stage = document.querySelector('#stage');
      const box = stage?.getBoundingClientRect();
      return (
        `url=${location.href} title=${document.title || '(none)'} ` +
        `stage=${stage === null ? 'missing' : `${box?.width}x${box?.height}`} ` +
        `body=${document.body.innerHTML.replace(/\s+/g, ' ').slice(0, 200)}`
      );
    });
  } catch (error) {
    return `could not describe the page: ${String(error).split('\n')[0]}`;
  }
}

interface Result {
  readonly label: string;
  readonly failures: readonly string[];
  readonly frames?: number;
  readonly colours?: number;
  readonly version?: string;
}

async function check(
  browser: Browser,
  origin: string,
  { mode, renderer }: (typeof COMBINATIONS)[number],
): Promise<Result> {
  const label = `${mode}/${renderer}`;
  const failures: string[] = [];
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  // Both channels: an unhandled throw and a logged error are different events,
  // and a failed shader link surfaces as the second one.
  page.on('pageerror', error => failures.push(`uncaught: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console.error: ${message.text()}`);
  });
  // A crashed renderer process takes the DOM with it, so everything after it
  // fails as "element not found" and blames the wrong thing.
  page.on('crash', () => failures.push('the tab crashed'));
  // A chunk or the atlas answering 404 is exactly the failure this exists for.
  watchRequests(page, failures);

  try {
    // `?profile` is what publishes the frame counter on window.
    const response = await page.goto(
      `${origin}/?seed=${SEED}&profile&mode=${mode}&renderer=${renderer}`,
      { waitUntil: 'load' },
    );
    // Checked explicitly, because a 404 page is a perfectly valid page: it
    // loads, it has no `#boot` to wait for, and everything after this would
    // fail somewhere far away from the cause.
    const status = response?.status() ?? 0;
    if (status !== 200) throw new Error(`the page answered ${status}`);
    await waitForBoot(page);
  } catch (error) {
    failures.push(
      `never finished booting: ${error instanceof Error ? error.message : String(error)}`,
    );
    await page.close();
    return { label, failures };
  }

  // Everything past the boot is wrapped: one combination falling over should be
  // a reported failure, not an exception that abandons the other three.
  let frames = 0;
  let colours = 0;
  let version = '';
  try {
    await playOneShot(page);
    // The page renders on demand rather than every animation frame, so give the
    // last of the shot's frames a moment to land before reading the counter.
    await sleep(200);

    frames = await page.evaluate(() => window.__hamsterProfile?.framesSeen ?? 0);
    if (frames === 0) failures.push('booted and played a shot but drew no frames');

    colours = await distinctColours(page);
    if (colours < MIN_COLOURS) {
      failures.push(`canvas has ${colours} distinct colour(s) - nothing was drawn`);
    }

    // The build stamp is substituted at build time, so an empty slot means the
    // define never fired - and the deployed page could not be identified.
    version = await page.evaluate(() => document.querySelector('#version')?.textContent ?? '');
    if (version.trim() === '') failures.push('the build stamp is empty');
  } catch (error) {
    failures.push(String(error).split('\n')[0] ?? String(error));
    failures.push(await describe(page));
  }

  await page.close();
  return { label, failures, frames, colours, version };
}

async function main(): Promise<void> {
  const server = await startServer(PORT);
  const browser = await launchChromium();
  const results: Result[] = [];
  try {
    for (const combination of COMBINATIONS) {
      process.stderr.write(`checking ${combination.mode}/${combination.renderer}...\n`);
      results.push(await check(browser, server.origin, combination));
    }
  } finally {
    await browser.close();
    await server.stop();
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

run(main);
