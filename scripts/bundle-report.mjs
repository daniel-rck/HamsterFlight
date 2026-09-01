#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
// What each JS chunk actually costs a visitor, gzipped - the number that
// matters for the PixiJS evaluation. Because the Pixi backend is behind a
// dynamic import, one build produces both the default entry chunk and the
// Pixi chunk, so they can be compared without building twice.
//
// Read-only over dist/. Run `npm run build` first.
import { gzipSync } from 'node:zlib';

const DIST = 'dist/assets';
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
 */
const BUDGET_KB = {
  // Every visitor pays this.
  eager: 16,
  // Only under ?renderer=pixi - but that is the default for enhanced mode.
  lazy: 182,
  // Per atlas sheet, per density.
  atlas: { 1: 850, 2: 2250 },
};

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

async function main() {
  let names;
  try {
    names = (await readdir(DIST)).sort();
  } catch {
    console.error(`${DIST} not found - run "npm run build" first.`);
    process.exitCode = 1;
    return;
  }

  // The entry chunk is whatever index.html loads eagerly. Everything else is
  // reachable only through the dynamic import in main.ts, i.e. it is the Pixi
  // backend and is downloaded only when ?renderer=pixi is used.
  let entry = null;
  try {
    const html = await readFile('dist/index.html', 'utf8');
    entry = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1] ?? null;
  } catch {
    // No index.html: fall back to reporting every chunk ungrouped.
  }

  const rows = [];
  for (const name of names.filter(item => item.endsWith('.js'))) {
    const source = await readFile(join(DIST, name));
    rows.push({
      name,
      raw: source.byteLength,
      gzip: gzipSync(source, { level: 9 }).byteLength,
      lazy: entry !== null && name !== entry,
    });
  }
  rows.sort((a, b) => b.gzip - a.gzip);

  const width = Math.max(24, ...rows.map(row => row.name.length));
  const line = '-'.repeat(width + 26);
  const head = `${'chunk'.padEnd(width)}  ${'raw'.padStart(10)}  ${'gzip'.padStart(10)}`;

  const totals = { eager: { raw: 0, gzip: 0 }, lazy: { raw: 0, gzip: 0 } };
  for (const group of [false, true]) {
    const group_rows = rows.filter(row => row.lazy === group);
    if (group_rows.length === 0) continue;
    console.log(group ? '\nlazy - only downloaded with ?renderer=pixi' : 'eager - every visitor');
    console.log(head);
    console.log(line);
    for (const row of group_rows) {
      const bucket = row.lazy ? totals.lazy : totals.eager;
      bucket.raw += row.raw;
      bucket.gzip += row.gzip;
      const over = row.raw / 1024 > CHUNK_WARN_KB ? `  <- over ${CHUNK_WARN_KB} kB warn limit` : '';
      console.log(
        `${row.name.padEnd(width)}  ${kb(row.raw).padStart(10)}  ${kb(row.gzip).padStart(10)}${over}`,
      );
    }
    const bucket = group ? totals.lazy : totals.eager;
    console.log(line);
    console.log(
      `${'subtotal'.padEnd(width)}  ${kb(bucket.raw).padStart(10)}  ${kb(bucket.gzip).padStart(10)}`,
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
  const sheets = [];
  for (const name of names.filter(item => /^sheet-.*\.png$/.test(item))) {
    // Vite content-hashes the name, so the density marker is mid-string:
    // `sheet-0@2x-C3sMDfDD.png`.
    const density = /@(\d+)x[-.]/.exec(name);
    sheets.push({
      name,
      density: density === null ? 1 : Number(density[1]),
      raw: (await readFile(join(DIST, name))).byteLength,
    });
  }
  if (sheets.length > 0) {
    console.log('\natlas - one request, one GPU texture');
    for (const sheet of sheets) {
      console.log(`${sheet.name.padEnd(width)}  ${kb(sheet.raw).padStart(10)}`);
    }
  }

  if (!process.argv.includes('--check')) return;

  const over = [];
  const budget = (what, bytes, limitKb) => {
    if (bytes / 1024 > limitKb) {
      over.push(`${what}: ${kb(bytes)} over a ${limitKb} kB budget`);
    }
  };
  budget('eager JS (gzip)', totals.eager.gzip, BUDGET_KB.eager);
  budget('lazy JS (gzip)', totals.lazy.gzip, BUDGET_KB.lazy);
  for (const sheet of sheets) {
    const limit = BUDGET_KB.atlas[sheet.density];
    if (limit === undefined) {
      over.push(`${sheet.name}: density ${sheet.density}x has no budget - add one to BUDGET_KB`);
      continue;
    }
    budget(sheet.name, sheet.raw, limit);
  }

  console.log('');
  if (over.length === 0) {
    console.log('Within budget.');
    return;
  }
  for (const line of over) console.error(`  ${line}`);
  console.error(
    `\n${over.length} over budget. If the growth is intended, raise the number in ` +
      'BUDGET_KB so the increase shows up in the diff.',
  );
  process.exitCode = 1;
}

await main();
