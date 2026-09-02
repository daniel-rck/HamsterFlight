// Starting a real build in a real browser, for the scripts that need one.
//
// Two callers - the renderer benchmark and the smoke test - and every awkward
// detail here was paid for once already: the ambient proxy that swallows
// loopback requests, the software rasteriser flags that make WebGL work with no
// GPU, and the Chromium build mismatch that shows up in containers which ship
// their own. Kept in one place so the two cannot drift apart.
import { type ChildProcess, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { type Browser, chromium, type Page } from 'playwright';
import { intEnv, ROOT } from './cli.ts';

// Node's fetch and the browser both have to reach the loopback server directly.
process.env.NO_PROXY = ['127.0.0.1', 'localhost', process.env.NO_PROXY].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;

/** How long to wait for a server to come up, overridable for slow machines. */
const STARTUP_MS = intEnv('PREVIEW_TIMEOUT_MS', 15_000);
const POLL_MS = 250;
/** SIGTERM first; a child that ignores it gets SIGKILL after this. */
const STOP_GRACE_MS = 3000;

export interface Server {
  readonly origin: string;
  /** Resolves once the process is gone, so a caller's exit is never held open. */
  stop(): Promise<void>;
}

/** True when something already answers on `origin`. Any response counts. */
async function listening(origin: string): Promise<boolean> {
  try {
    await fetch(origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a local server process and wait until it answers.
 *
 * `process.execPath` with the tool's own entry point, rather than `npx`: it
 * skips the resolver, it works on Windows where `npx` is `npx.cmd`, and it
 * leaves exactly one process to stop. `detached` still puts the child in its
 * own group on POSIX so anything it spawns goes with it.
 *
 * Both streams are piped *and drained*: an unread pipe keeps the handle - and
 * therefore the whole process - alive after the child is killed, but a pipe
 * nobody has is a failure with no explanation, which is how this cost a CI
 * round. The tail goes into the timeout message.
 */
async function startProcess(
  label: string,
  entry: string,
  args: string[],
  origin: string,
): Promise<Server> {
  // Refuse to run against someone else's server. A stale preview from an
  // earlier run serves an earlier `dist`, so the test would pass on bytes
  // nobody built.
  if (await listening(origin)) {
    throw new Error(
      `something is already serving ${origin} - stop it first, or set a different port`,
    );
  }

  const child: ChildProcess = spawn(process.execPath, [entry, ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let output = '';
  const collect = (chunk: Buffer | string): void => {
    output = `${output}${chunk}`.slice(-2000);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  let exited: number | null = null;
  const gone = new Promise<void>(resolve => {
    child.on('exit', code => {
      exited = code ?? -1;
      resolve();
    });
  });

  const signal = (name: NodeJS.Signals): void => {
    if (exited !== null || child.pid === undefined) return;
    try {
      if (process.platform === 'win32') child.kill(name);
      else process.kill(-child.pid, name);
    } catch {
      child.kill(name);
    }
  };
  const stop = async (): Promise<void> => {
    if (exited !== null) return;
    signal('SIGTERM');
    const timer = sleep(STOP_GRACE_MS).then(() => 'timeout' as const);
    if ((await Promise.race([gone, timer])) === 'timeout') {
      signal('SIGKILL');
      await gone;
    }
  };

  const deadline = Date.now() + STARTUP_MS;
  while (Date.now() < deadline) {
    if (exited !== null)
      throw new Error(`${label} exited with ${exited} before serving:\n${output}`);
    // Any answer means it is listening. Insisting on 2xx here would turn a
    // missing `dist/index.html` into a timeout that blames the wrong thing.
    if (await listening(origin)) return { origin, stop };
    await sleep(POLL_MS);
  }
  await stop();
  throw new Error(`${label} did not come up on ${origin} within ${STARTUP_MS} ms:\n${output}`);
}

/**
 * `vite preview` over `dist`, so what is tested is the real build with the real
 * chunk splitting - not the dev server's unbundled modules.
 *
 * `--host 127.0.0.1` because that is the address probed and the address the
 * browser is pointed at. Vite's default binds `localhost`, which on a GitHub
 * runner resolves to ::1 first - so the server comes up perfectly and an IPv4
 * probe never reaches it.
 */
export function startServer(port = intEnv('PORT', 4173)): Promise<Server> {
  const origin = `http://127.0.0.1:${port}`;
  return startProcess(
    'vite preview',
    new URL('../../node_modules/vite/bin/vite.js', import.meta.url).pathname,
    ['preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    origin,
  );
}

/**
 * `wrangler dev` over `dist`, which is the only local server that applies
 * `wrangler.jsonc` and `public/_headers` the way production does.
 */
export function startWrangler(port = intEnv('PORT', 8788)): Promise<Server> {
  const origin = `http://127.0.0.1:${port}`;
  return startProcess(
    'wrangler dev',
    new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname,
    ['dev', '--port', String(port), '--ip', '127.0.0.1', '--show-interactive-dev-session=false'],
    origin,
  );
}

export function launchChromium(): Promise<Browser> {
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
export async function waitForBoot(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const boot = document.querySelector<HTMLElement>('#boot');
      return (boot === null || boot.hidden) && document.querySelector('#stage') !== null;
    },
    undefined,
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
export async function playOneShot(page: Page): Promise<void> {
  const tap = async (): Promise<void> => {
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

/** Collect every failed or 4xx/5xx subresource, so a 404'd chunk is a named failure. */
export function watchRequests(page: Page, failures: string[]): void {
  page.on('response', response => {
    if (response.status() >= 400) {
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on('requestfailed', request => {
    failures.push(
      `request failed: ${new URL(request.url()).pathname} (${request.failure()?.errorText ?? '?'})`,
    );
  });
}
