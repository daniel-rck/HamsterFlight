// Starting a real build in a real browser, for the scripts that need one.
//
// Two callers - the renderer benchmark and the smoke test - and every awkward
// detail here was paid for once already: the ambient proxy that swallows
// loopback requests, the software rasteriser flags that make WebGL work with no
// GPU, and the Chromium build mismatch that shows up in containers which ship
// their own. Kept in one place so the two cannot drift apart.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

// Node's fetch and the browser both have to reach the loopback server directly.
process.env.NO_PROXY = ['127.0.0.1', 'localhost', process.env.NO_PROXY].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;

/**
 * `vite preview` over `dist`, so what is tested is the real build with the real
 * chunk splitting - not the dev server's unbundled modules.
 *
 * Returns `{ origin, stop }`; the caller calls `stop()` when it is done.
 */
export async function startServer(port = 4173) {
  const origin = `http://127.0.0.1:${port}`;

  // Refuse to run against someone else's server. `--strictPort` makes vite
  // exit when the port is taken, but the poll below would then happily talk to
  // whatever was already there - and a stale preview from an earlier run
  // serves an earlier `dist`, so the test would pass on bytes nobody built.
  try {
    await fetch(origin);
    throw new Error(
      `something is already serving ${origin} - stop it first, or set a different port`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('something is already')) throw error;
  }

  // `--host 127.0.0.1` because that is the address probed below and the address
  // the browser is pointed at. Vite's default binds `localhost`, which on a
  // GitHub runner resolves to ::1 first - so the server comes up perfectly and
  // an IPv4 probe never reaches it.
  //
  // `detached` puts the child in its own process group, so `stop()` can take
  // the whole group down. Killing the pid alone kills only the `npx` wrapper
  // and leaves the vite process it spawned reparented to init, still holding
  // the port - which is what the guard above kept tripping over.
  //
  // Both streams are piped *and drained*: an unread pipe keeps the handle - and
  // therefore the whole process - alive after the child is killed, but a pipe
  // nobody has is a failure with no explanation, which is how this cost a CI
  // round. The tail goes into the timeout message.
  const server = spawn(
    'npx',
    ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let output = '';
  const collect = chunk => {
    output = `${output}${chunk}`.slice(-2000);
  };
  server.stdout?.on('data', collect);
  server.stderr?.on('data', collect);

  let exited = null;
  server.on('exit', code => {
    exited = code;
  });

  const stop = () => {
    if (exited !== null || server.pid === undefined) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  };

  for (let attempt = 0; attempt < 60; attempt++) {
    if (exited !== null) {
      throw new Error(`vite preview exited with ${exited} before serving:\n${output}`);
    }
    try {
      // Any answer means it is listening. Insisting on 2xx here would turn a
      // missing `dist/index.html` into a timeout that blames the wrong thing.
      await fetch(origin);
      return { origin, stop };
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  stop();
  throw new Error(`vite preview did not come up on ${origin}:\n${output}`);
}

export function launchChromium() {
  return chromium.launch({
    // Set CHROMIUM_EXECUTABLE when the environment ships a Chromium that does
    // not match this Playwright version's expected build, rather than
    // downloading a second one. CI installs the matching build and needs none.
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: [
      // Everything these scripts load is on loopback, and an ambient agent
      // proxy in the environment would otherwise swallow it.
      '--no-proxy-server',
      // WebGL with no GPU. Without these the Pixi backend has no context at
      // all, and a smoke test would be asserting on a page that never drew.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
}

/**
 * Wait until the game is up: the boot placeholder hidden *and* the stage there.
 *
 * Both halves are needed. `main.ts` hides `#boot` when it is ready (it stays in
 * the document so a later failure has somewhere to report), so its absence
 * looks like success - but it is equally absent from a 404 page, and an
 * earlier version of this reported a served-nothing as a click timeout several
 * steps later.
 */
export async function waitForBoot(page, timeout = 60000) {
  await page.waitForFunction(
    () => {
      const boot = document.querySelector('#boot');
      return (boot === null || boot.hidden) && document.querySelector('#stage') !== null;
    },
    { timeout },
  );
}

/**
 * One shot, played: jump, hit the pillow, hold to glide. The timings are the
 * original's - the jump arc is about 700 ms of real time.
 *
 * Driven by the keyboard, not the mouse. `InputController` gives Space and a
 * pointer identical meaning (press + confirm on the way down, release on the
 * way up), and clicking a canvas has to pass Playwright's actionability checks
 * against an element the renderer is repainting twenty times a second. Under
 * the headless shell on a CI runner that never settled: both WebGL runs failed
 * on a click that timed out against a perfectly healthy page, while the two
 * Canvas2D runs passed. A key press has no hit test to fail.
 */
export async function playOneShot(page) {
  // The listeners are on the canvas, so it has to hold focus. `focus()` in the
  // page rather than Playwright's, which waits on the element the same way.
  await page.$eval('#stage', element => element.focus());

  const tap = async () => {
    await page.keyboard.down(' ');
    await sleep(40);
    await page.keyboard.up(' ');
  };

  await tap();
  await sleep(700);
  await tap();
  await sleep(120);
  await page.keyboard.down(' ');
  await sleep(2600);
  await page.keyboard.up(' ');
  await sleep(1200);
}
