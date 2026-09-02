// What a visitor downloads, chunk by chunk, gzipped the way the CDN serves it.
//
//   bun run build && bun run bundle:report          # the table
//   bun run build && bun run check:bundle           # the table, then the budgets
//
// Read-only over dist/. Run `bun run build` first.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ROOT, run } from "./lib/cli.ts";

const DIST = join(ROOT, "dist");
const ASSETS = join(DIST, "assets");
// Vite's own warning limit, from vite.config.ts. Reported, never raised.
const CHUNK_WARN_KB = 400;

/**
 * Budgets, in kB, checked only under `--check`.
 *
 * Each is the measured value plus headroom - 15% on the gzipped JS, 10% on the
 * atlas, which is already PNG-compressed and moves in bigger steps. Raising one
 * is meant to be a visible line in a diff rather than something that drifts:
 * the PR that shipped the WebGL mode makes claims about exactly these numbers,
 * and this is what stops them quietly expiring.
 *
 * Measured on the launcher commit:
 *   eager  14 264 B gzip     lazy  162 459 B gzip
 *   1x atlas 776 126 B       2x atlas 2 028 490 B
 * Re-measured after the shared scene module, interpolation and the input and
 * lifecycle hardening: eager 16.5 kB gzip. The lazy chunk shrank a little.
 */
const BUDGET_KB: { eager: number; lazy: number; atlas: Record<number, number> } = {
  // Every visitor pays this.
  eager: 19,
  // Only under ?renderer=pixi - but that is the default for enhanced mode.
  lazy: 182,
  // Per atlas sheet, per density.
  atlas: { 1: 850, 2: 2250 },
};

interface Row {
  readonly name: string;
  readonly raw: number;
  readonly gzip: number;
  readonly lazy: boolean;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * Everything index.html loads before the first frame: the module script and
 * whatever it preloads. A `<link rel="modulepreload">` chunk is downloaded by
 * every visitor just like the entry, so it belongs in the eager bucket - the
 * old single `src=` match would have filed it under lazy.
 */
function eagerChunks(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g))
    if (m[1]) out.add(m[1]);
  for (const m of html.matchAll(
    /<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g,
  )) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

async function main(): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(ASSETS)).sort();
  } catch {
    throw new Error('dist/assets not found - run "bun run build" first.');
  }

  let eager = new Set<string>();
  try {
    eager = eagerChunks(await readFile(join(DIST, "index.html"), "utf8"));
  } catch {
    // No index.html: fall back to reporting every chunk as eager.
  }

  const rows: Row[] = [];
  for (const name of names.filter((item) => item.endsWith(".js"))) {
    const source = await readFile(join(ASSETS, name));
    rows.push({
      name,
      raw: source.byteLength,
      gzip: gzipSync(source, { level: 9 }).byteLength,
      lazy: eager.size > 0 && !eager.has(name),
    });
  }
  rows.sort((a, b) => b.gzip - a.gzip);

  const width = Math.max(24, ...rows.map((row) => row.name.length));
  const line = "-".repeat(width + 26);
  const head = `${"chunk".padEnd(width)}  ${"raw".padStart(10)}  ${"gzip".padStart(10)}`;

  const totals = { eager: { raw: 0, gzip: 0 }, lazy: { raw: 0, gzip: 0 } };
  for (const group of [false, true]) {
    const groupRows = rows.filter((row) => row.lazy === group);
    if (groupRows.length === 0) continue;
    console.log(group ? "\nlazy - only downloaded with ?renderer=pixi" : "eager - every visitor");
    console.log(head);
    console.log(line);
    const bucket = group ? totals.lazy : totals.eager;
    for (const row of groupRows) {
      bucket.raw += row.raw;
      bucket.gzip += row.gzip;
      const over = row.raw / 1024 > CHUNK_WARN_KB ? `  <- over ${CHUNK_WARN_KB} kB warn limit` : "";
      console.log(
        `${row.name.padEnd(width)}  ${kb(row.raw).padStart(10)}  ${kb(row.gzip).padStart(10)}${over}`,
      );
    }
    console.log(line);
    console.log(
      `${"subtotal".padEnd(width)}  ${kb(bucket.raw).padStart(10)}  ${kb(bucket.gzip).padStart(10)}`,
    );
  }

  if (totals.lazy.gzip > 0) {
    const factor = (totals.lazy.gzip / totals.eager.gzip).toFixed(1);
    console.log(
      `\nThe Pixi backend adds ${kb(totals.lazy.gzip)} gzip on top of a ` +
        `${kb(totals.eager.gzip)} app - ${factor}x the entire rest of the game.`,
    );
  }

  // The atlas is the largest thing a visitor downloads and is not a JS chunk,
  // so it is measured raw: a PNG is already compressed and gzip buys nothing.
  const sheets: { name: string; density: number; raw: number }[] = [];
  for (const name of names.filter((item) => /^sheet-.*\.png$/.test(item))) {
    // Vite content-hashes the name, so the density marker is mid-string:
    // `sheet-0@2x-C3sMDfDD.png`.
    const density = /@(\d+)x[-.]/.exec(name);
    sheets.push({
      name,
      density: density?.[1] === undefined ? 1 : Number(density[1]),
      raw: (await readFile(join(ASSETS, name))).byteLength,
    });
  }
  if (sheets.length > 0) {
    console.log("\natlas - one request, one GPU texture");
    for (const sheet of sheets) {
      console.log(`${sheet.name.padEnd(width)}  ${kb(sheet.raw).padStart(10)}`);
    }
  }

  if (!process.argv.includes("--check")) return;

  const over: string[] = [];
  const budget = (what: string, bytes: number, limitKb: number): void => {
    if (bytes / 1024 > limitKb) over.push(`${what}: ${kb(bytes)} over a ${limitKb} kB budget`);
  };
  budget("eager JS (gzip)", totals.eager.gzip, BUDGET_KB.eager);
  budget("lazy JS (gzip)", totals.lazy.gzip, BUDGET_KB.lazy);
  for (const sheet of sheets) {
    const limit = BUDGET_KB.atlas[sheet.density];
    if (limit === undefined) {
      over.push(`${sheet.name}: density ${sheet.density}x has no budget - add one to BUDGET_KB`);
      continue;
    }
    budget(sheet.name, sheet.raw, limit);
  }

  console.log("");
  if (over.length === 0) {
    console.log("Within budget.");
    return;
  }
  for (const item of over) console.error(`  ${item}`);
  console.error(
    `\n${over.length} over budget. If the growth is intended, raise the number in ` +
      "BUDGET_KB so the increase shows up in the diff.",
  );
  process.exitCode = 1;
}

run(main);
