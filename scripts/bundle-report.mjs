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

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

async function main() {
  let names;
  try {
    names = (await readdir(DIST)).filter(name => name.endsWith('.js')).sort();
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
  for (const name of names) {
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
}

await main();
