#!/usr/bin/env node
// The sim must be deterministic: same seed, same commands, same trajectory.
// tsconfig.sim.json already removes the DOM from src/sim, but it cannot catch
// non-determinism that is validly typed - Math.random, Date.now, timers. This
// does. Kept as a plain script so it runs anywhere with no dependencies.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = 'src/sim';
const FORBIDDEN = [
  [/\bMath\s*\.\s*random\b/, 'Math.random - inject an Rng instead (src/sim/rng)'],
  [/\bDate\s*\.\s*now\b/, 'Date.now - the sim steps in fixed ticks, it must not read a clock'],
  [/\bnew\s+Date\b/, 'new Date - the sim steps in fixed ticks, it must not read a clock'],
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'timers - the loop drives the sim, not the reverse'],
  [/\bperformance\s*\./, 'performance - time must not enter the sim'],
  [/\bMath\s*\.\s*hypot\b/, 'Math.hypot - the original uses sqrt(dx*dx+dy*dy); not bit-identical'],
];

/**
 * Blank out comments and string literals, preserving line structure, so the
 * rules apply to code only. Documenting what the original did - and it did use
 * setInterval and Math.random - must not trip the check.
 */
function stripNonCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const keepNewlines = text => text.replace(/[^\n]/g, ' ');

  while (i < n) {
    const two = src.slice(i, i + 2);
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const quote = src[i];
      let j = i + 1;
      while (j < n && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, n);
      out += keepNewlines(src.slice(i, stop));
      i = stop;
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

let failures = 0;
for await (const file of walk(ROOT)) {
  const code = stripNonCode(await readFile(file, 'utf8'));
  code.split('\n').forEach((line, index) => {
    for (const [pattern, why] of FORBIDDEN) {
      if (pattern.test(line)) {
        console.error(`${file}:${index + 1}  forbidden in src/sim: ${why}`);
        failures++;
      }
    }
  });
}

if (failures > 0) {
  console.error(`\nsim purity check failed: ${failures} violation(s).`);
  process.exit(1);
}
console.log('sim purity check passed.');
