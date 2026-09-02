// The sim must be deterministic: same seed, same commands, same trajectory.
// tsconfig.sim.json already removes the DOM from src/sim, but it cannot catch
// non-determinism that is validly typed - Math.random, Date.now, timers - and
// nothing else checks that src/sim imports only from src/sim. This does both.
//
//   node scripts/check-sim-purity.ts
//
// The checker is a function over source text so test/scripts/purity.spec.ts
// can prove it rejects what it claims to; a check that fails open is worse
// than none.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { isMain, ROOT, run } from "./lib/cli.ts";

export const SIM_ROOT = "src/sim";

/**
 * Forbidden in `src/sim`, matched against the whole comment- and string-free
 * source rather than line by line, so a member expression split across lines
 * (`Math.\n random()`) cannot slip through.
 */
export const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/\bMath\s*\.\s*random\b/, "Math.random - inject an Rng instead (src/sim/rng)"],
  [/\bMath\s*\[/, "computed access on Math (Math['random']) - inject an Rng instead"],
  [/\bDate\s*\.\s*now\b/, "Date.now - the sim steps in fixed ticks, it must not read a clock"],
  [/\bnew\s+Date\b/, "new Date - the sim steps in fixed ticks, it must not read a clock"],
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, "timers - the loop drives the sim, not the reverse"],
  [/\bperformance\s*\./, "performance - time must not enter the sim"],
  [/\bcrypto\b/, "crypto - randomness is injected through Rng"],
  [/\bglobalThis\b/, "globalThis - the sim has no ambient environment"],
  [/\bprocess\s*\./, "process - the sim has no ambient environment"],
  [/\.\s*sort\s*\(\s*\)/, ".sort() without a comparator - numbers sort as strings"],
  [/\btoLocale\w*\s*\(/, "toLocale* - locale-dependent output is not deterministic"],
  [
    /\bMath\s*\.\s*hypot\b/,
    "Math.hypot - the original uses sqrt(dx*dx+dy*dy); different algorithm",
  ],
];

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly why: string;
}

/**
 * Blank out comments, string literals and regex literals, preserving line
 * structure, so the rules apply to code only. Documenting what the original
 * did - and it did use setInterval and Math.random - must not trip the check.
 *
 * Regex literals matter because `/["']/` would otherwise open a string that
 * never closes and blank out the rest of the file - a silent pass. A slash is
 * a regex when the previous significant character cannot end an operand.
 */
export function stripNonCode(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  const blank = (text: string): string => text.replace(/[^\n]/g, " ");
  let lastSignificant = "";

  while (i < n) {
    const two = src.slice(i, i + 2);
    const ch = src[i] ?? "";
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, n);
      out += blank(src.slice(i, stop));
      i = stop;
      lastSignificant = ch;
    } else if (ch === "/" && !/[\w$)\]]/.test(lastSignificant)) {
      // Regex literal: skip to the closing slash, honouring escapes and classes.
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        const c = src[j];
        if (c === "\\") j += 2;
        else if (c === "[") {
          inClass = true;
          j++;
        } else if (c === "]") {
          inClass = false;
          j++;
        } else if (c === "/" && !inClass) break;
        else j++;
      }
      const stop = Math.min(j + 1, n);
      out += blank(src.slice(i, stop));
      i = stop;
      lastSignificant = "/";
    } else {
      out += ch;
      if (!/\s/.test(ch)) lastSignificant = ch;
      i++;
    }
  }
  return out;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Every rule, against one file's source. `file` is only used for reporting. */
export function checkSource(file: string, source: string): Violation[] {
  const code = stripNonCode(source);
  const out: Violation[] = [];
  for (const [pattern, why] of FORBIDDEN) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of code.matchAll(global)) {
      out.push({ file, line: lineOf(code, match.index ?? 0), why });
    }
  }
  out.push(...checkImports(file, code));
  return out;
}

/**
 * The boundary the README advertises: nothing under src/sim imports from
 * outside src/sim. Not a package, not the alias, not a relative path that
 * climbs out. This is the rule most likely to be broken by accident, and the
 * one neither the typecheck nor the globals list can see.
 */
export function checkImports(file: string, code: string): Violation[] {
  const out: Violation[] = [];
  const pattern =
    /\b(?:import|export)\b[^;]*?\bfrom\s*\(?\s*(['"`])([^'"`]+)\1|\bimport\s*\(\s*(['"`])([^'"`]+)\3/g;
  for (const match of code.matchAll(pattern)) {
    const spec = match[2] ?? match[4];
    if (spec === undefined) continue;
    const line = lineOf(code, match.index ?? 0);
    if (!spec.startsWith("./") && !spec.startsWith("../")) {
      out.push({ file, line, why: `imports '${spec}' - src/sim may only import from src/sim` });
      continue;
    }
    // Resolve relative to the file and make sure it stays under src/sim.
    const dir = file.slice(0, file.lastIndexOf("/") + 1);
    const parts = `${dir}${spec}`.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (part === "..") stack.pop();
      else if (part !== "." && part !== "") stack.push(part);
    }
    const resolved = stack.join("/");
    if (!resolved.startsWith(`${SIM_ROOT}/`)) {
      out.push({ file, line, why: `imports '${spec}', which leaves ${SIM_ROOT}/` });
    }
  }
  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith(".ts")) yield path;
  }
}

export async function checkTree(
  root = join(ROOT, SIM_ROOT),
): Promise<{ files: number; violations: Violation[] }> {
  const violations: Violation[] = [];
  let files = 0;
  for await (const path of walk(root)) {
    files++;
    // Reported and matched as `src/sim/...` regardless of where we were run from.
    const file = relative(ROOT, path).split("\\").join("/");
    // Note the source is stripped, not the file on disk: the import check runs
    // on the same comment-free text as the rules.
    violations.push(...checkSource(file, await readFile(path, "utf8")));
  }
  return { files, violations };
}

if (isMain(import.meta.url)) {
  run(async () => {
    const { files, violations } = await checkTree();
    if (files === 0) throw new Error(`no .ts files under ${SIM_ROOT} - wrong directory?`);
    for (const v of violations)
      console.error(`${v.file}:${v.line}  forbidden in ${SIM_ROOT}: ${v.why}`);
    if (violations.length > 0) {
      console.error(`\nsim purity check failed: ${violations.length} violation(s).`);
      process.exitCode = 1;
      return;
    }
    console.log(`sim purity check passed (${files} files).`);
  });
}
