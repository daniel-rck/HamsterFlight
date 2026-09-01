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

/** The boot placeholder in index.html; `main.ts` removes it once it is up. */
export async function waitForBoot(page, timeout = 60000) {
  await page.waitForFunction(() => document.querySelector('#boot') === null, { timeout });
}

/**
 * One shot, played: click to jump, click to hit the pillow, hold to glide.
 * The timings are the original's - the jump arc is about 700 ms of real time.
 */
export async function playOneShot(page) {
  const canvas = page.locator('#stage');
  await canvas.click({ force: true, timeout: 2000 });
  await sleep(700);
  await canvas.click({ force: true, timeout: 2000 });
  await sleep(120);
  await page.mouse.down();
  await sleep(2600);
  await page.mouse.up();
  await sleep(1200);
}
