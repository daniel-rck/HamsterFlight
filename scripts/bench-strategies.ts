/**
 * The successor to `reference/legacy/sim.js`: the same exploratory table, but
 * computed from the real engine instead of a paraphrase of it.
 *
 *   node --experimental-strip-types scripts/bench-strategies.ts [--seeds 300]
 *
 * Runs without a bundler because `src/sim` is DOM-free and every relative
 * import carries its `.ts` extension, so Node's own type stripping is enough.
 */

import type { InputCommand } from '../src/sim/commands.ts';
import { C } from '../src/sim/constants.ts';
import { Simulation } from '../src/sim/Simulation.ts';
import type { SimSnapshot } from '../src/sim/state.ts';

type Hold = (s: SimSnapshot) => boolean;

const never: Hold = () => false;
const mash: Hold = s => s.glidePoints > 0;
const smart: Hold = s => s.glidePoints > 0 && s.hamster.yvel > -5;

interface Shot {
  feet: number;
  peakUp: number;
  outcome: string;
}

function shot(seed: number, clickTick: number, hold: Hold): Shot {
  const sim = new Simulation({ seed });
  sim.step([{ kind: 'press' }, { kind: 'release' }]);
  for (let t = 0; t < clickTick && sim.phaseKind === 'jumping'; t++) sim.step();
  if (sim.phaseKind !== 'jumping') return { feet: 0, peakUp: 0, outcome: 'zero' };

  const events = sim.step([{ kind: 'press' }, { kind: 'release' }]);
  if (events.some(e => e.t === 'missed')) return { feet: 0, peakUp: 0, outcome: 'miss' };

  const launchY = sim.snapshot().hamster.y;
  let minY = launchY;
  let down = false;
  let feet = 0;
  let outcome = 'cheer';

  for (let t = 0; t < 8000; t++) {
    const snap = sim.snapshot();
    if (snap.phaseKind !== 'flying') break;
    if (snap.hamster.y < minY) minY = snap.hamster.y;
    const want = hold(snap);
    const commands: InputCommand[] = [];
    if (want && !down) commands.push({ kind: 'press' });
    else if (!want && down) commands.push({ kind: 'release' });
    down = want;
    for (const ev of sim.step(commands)) {
      if (ev.t === 'shotDone') {
        feet = ev.feet;
        outcome = ev.outcome;
      }
    }
  }
  return { feet, peakUp: Math.round(launchY - minY), outcome };
}

const argv = process.argv.slice(2);
const seedIndex = argv.indexOf('--seeds');
const seedCount = seedIndex === -1 ? 300 : Number(argv[seedIndex + 1] ?? 300);

console.log(`tick  ${'never'.padStart(20)}${'mash'.padStart(22)}${'smart'.padStart(22)}`);
for (let clickTick = 3; clickTick <= 26; clickTick++) {
  const cells = [never, mash, smart].map(hold => {
    const r = shot(0x5eed, clickTick, hold);
    if (r.outcome === 'miss') return 'miss'.padStart(21);
    return `${r.feet} ft / ${r.peakUp} up`.padStart(21);
  });
  console.log(String(clickTick).padStart(4), cells.join(' '));
}

const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1] ?? Number.NaN;
console.log(`\n${seedCount} seeds, best connecting click per seed:`);
for (const [name, hold] of [
  ['never', never],
  ['mash', mash],
  ['smart', smart],
] as const) {
  const feet: number[] = [];
  const peaks: number[] = [];
  for (let seed = 0; seed < seedCount; seed++) {
    let best = -1;
    let bestPeak = 0;
    for (let clickTick = 3; clickTick <= 26; clickTick++) {
      const r = shot(seed, clickTick, hold);
      if (r.outcome === 'miss') continue;
      if (r.feet > best) {
        best = r.feet;
        bestPeak = r.peakUp;
      }
    }
    if (best >= 0) {
      feet.push(best);
      peaks.push(bestPeak);
    }
  }
  console.log(
    `  ${name.padEnd(6)} landed ${String(feet.length).padStart(4)}/${seedCount}` +
      `  median ${String(median(feet)).padStart(5)} ft` +
      `  max ${String(Math.max(...feet)).padStart(6)} ft` +
      `  median peak ${String(median(peaks)).padStart(7)} px`,
  );
}
console.log(`\n(ground at y=${C.GROUND_Y}, space background at y=${C.SPACE_BG_Y})`);
