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
 * Returns `{ server, origin }`; the caller kills `server` when it is done.
 */
export async function startServer(port = 4173) {
  const origin = `http://127.0.0.1:${port}`;
  // stdout ignored rather than piped: nothing reads it, and an unread pipe
  // keeps the handle - and therefore the whole process - alive after the child
  // is killed. Harmless in an interactive benchmark, a hung job in CI.
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(origin);
      if (response.ok) return { server, origin };
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  server.kill();
  throw new Error(`vite preview did not come up on ${origin}`);
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
