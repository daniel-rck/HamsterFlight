// Does the deployed shape of the site behave? `vite preview` knows nothing of
// `wrangler.jsonc` or `public/_headers`, so until now the 404 handling, the
// cache rules and the security headers were first exercised in production.
// This serves `dist/` through `wrangler dev`, the only local server that
// applies them, and asserts each decision the config records.
//
//   bun run build && bun run check:cf
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { intEnv, ROOT, run } from "./lib/cli.ts";
import { startWrangler } from "./lib/preview.ts";

const PORT = intEnv("PORT", 8788);

interface Probe {
  readonly path: string;
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
}

async function probe(origin: string, path: string): Promise<Probe> {
  const response = await fetch(origin + path, { redirect: "manual" });
  return { path, status: response.status, headers: response.headers, body: await response.text() };
}

async function main(): Promise<void> {
  const html = await readFile(join(ROOT, "dist/index.html"), "utf8").catch(() => {
    throw new Error('dist/index.html not found - run "bun run build" first.');
  });
  const chunk = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  if (chunk === undefined) throw new Error("dist/index.html has no module script");

  const server = await startWrangler(PORT);
  const failures: string[] = [];
  const expect = (ok: boolean, what: string): void => {
    if (!ok) failures.push(what);
  };
  try {
    const home = await probe(server.origin, "/");
    expect(home.status === 200, `/ answered ${home.status}`);
    expect(home.body.includes('id="stage"'), "/ is not the game page");
    expect(
      home.headers.get("cache-control") === "public, max-age=0, must-revalidate",
      `/ cache-control is ${home.headers.get("cache-control")} - the shell must revalidate`,
    );
    for (const header of ["content-security-policy", "x-content-type-options", "referrer-policy"]) {
      expect(home.headers.has(header), `/ has no ${header} header`);
    }
    const csp = home.headers.get("content-security-policy") ?? "";
    expect(csp.includes("script-src 'self'"), `CSP does not pin script-src to self: ${csp}`);
    expect(csp.includes("frame-ancestors 'none'"), `CSP does not forbid framing: ${csp}`);

    const asset = await probe(server.origin, chunk);
    expect(asset.status === 200, `${chunk} answered ${asset.status}`);
    expect(
      (asset.headers.get("cache-control") ?? "").includes("immutable"),
      `${chunk} cache-control is ${asset.headers.get("cache-control")} - hashed assets cache forever`,
    );

    // Not SPA mode: an unknown path is a real 404 with the 404 page, never
    // index.html with a 200. wrangler.jsonc says why.
    const missing = await probe(server.origin, "/nope");
    expect(missing.status === 404, `/nope answered ${missing.status}, expected 404`);
    expect(!missing.body.includes('id="stage"'), "/nope served the game page - SPA fallback is on");

    const missingAsset = await probe(server.origin, "/assets/does-not-exist.js");
    expect(missingAsset.status === 404, `a missing hashed asset answered ${missingAsset.status}`);

    // auto-trailing-slash redirects the explicit file name onto /.
    const explicit = await probe(server.origin, "/index.html");
    expect(
      explicit.status === 200 || (explicit.status >= 300 && explicit.status < 400),
      `/index.html answered ${explicit.status}`,
    );
  } finally {
    await server.stop();
  }

  for (const failure of failures) console.error(`  ${failure}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} Cloudflare semantics problem(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("Cloudflare semantics ok: headers, immutable assets, real 404s.");
}

run(main);
