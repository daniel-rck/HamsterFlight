/**
 * The successor to `reference/legacy/sim.js`: the same exploratory table, but
 * computed from the real engine instead of a paraphrase of it.
 *
 *   node --experimental-strip-types scripts/bench-strategies.ts [--seeds 300]
 *
 * Runs without a bundler because `src/sim` is DOM-free and every relative
 * import carries its `.ts` extension, so Node's own type stripping is enough.
 * The driver is `src/sim/drive.ts`, the same one the golden tests use.
 */

import { C } from "../src/sim/constants.ts";
import { bestShot, hold, mash, median, never, runShot, smart } from "../src/sim/drive.ts";

const argv = process.argv.slice(2);
const seedIndex = argv.indexOf("--seeds");
const seedCount = seedIndex === -1 ? 300 : Number.parseInt(argv[seedIndex + 1] ?? "", 10);
if (!Number.isInteger(seedCount) || seedCount < 1) {
  console.error("--seeds wants a positive integer");
  process.exitCode = 2;
} else {
  const policies = [
    ["never", never],
    ["hold", hold],
    ["mash", mash],
    ["smart", smart],
  ] as const;

  console.log(`tick  ${policies.map(([name]) => name.padStart(22)).join("")}`);
  for (let clickTick = 3; clickTick <= 26; clickTick++) {
    const cells = policies.map(([, policy]) => {
      const r = runShot({ seed: 0x5eed, clickTick, hold: policy });
      if (r.outcome === "miss") return "miss".padStart(21);
      return `${r.feet} ft / ${r.peakUp} up${r.truncated ? "*" : ""}`.padStart(21);
    });
    console.log(String(clickTick).padStart(4), cells.join(" "));
  }

  console.log(`\n${seedCount} seeds, best connecting click per seed:`);
  for (const [name, policy] of policies) {
    const feet: number[] = [];
    const peaks: number[] = [];
    let truncated = 0;
    for (let seed = 0; seed < seedCount; seed++) {
      const best = bestShot(seed, policy);
      if (best === null) continue;
      feet.push(best.feet);
      peaks.push(best.peakUp);
      if (best.truncated) truncated++;
    }
    console.log(
      `  ${name.padEnd(6)} landed ${String(feet.length).padStart(4)}/${seedCount}` +
        `  median ${String(median(feet)).padStart(5)} ft` +
        `  max ${String(feet.reduce((a, b) => Math.max(a, b), 0)).padStart(6)} ft` +
        `  median peak ${String(median(peaks)).padStart(7)} px` +
        (truncated > 0 ? `  (${truncated} never ended)` : ""),
    );
  }
  console.log(`\n(ground at y=${C.GROUND_Y}, space background at y=${C.SPACE_BG_Y})`);
}
