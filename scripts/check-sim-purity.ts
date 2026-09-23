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
  [/(?<!\bnew\s+)\bDate\s*\(/, "Date() - returns the current time as a string"],
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

/** Keywords after which a `/` starts a regex literal rather than dividing. */
const REGEX_AFTER_KEYWORD = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "void",
  "delete",
  "instanceof",
  "new",
  "throw",
  "yield",
  "await",
  "do",
  "else",
]);

/**
 * Blank out comments, string literals and regex literals, preserving line
 * structure, so the rules apply to code only. Documenting what the original
 * did - and it did use setInterval and Math.random - must not trip the check.
 *
 * Regex literals matter because `/["']/` would otherwise open a string that
 * never closes and blank out the rest of the file - a silent pass. A slash is
 * a regex when the previous significant token cannot end an operand: an
 * operator, or a keyword like `return`.
 *
 * The `${...}` inside a template literal is code, and is scanned as code:
 * blanking the whole literal hid `${Math.random()}` from every rule.
 *
 * `keepStrings` leaves string literals in place (comments and regexes still
 * go), for the import check: it needs the specifiers, which blanking erased -
 * so it matched nothing at all.
 */
export function stripNonCode(src: string, keepStrings = false): string {
  let out = "";
  let i = 0;
  const n = src.length;
  const blankAlways = (text: string): string => text.replace(/[^\n]/g, " ");
  const blank = (text: string): string => (keepStrings ? text : blankAlways(text));
  let lastSignificant = "";
  // One entry per open brace: whether closing it resumes a template literal.
  const braces: boolean[] = [];

  /** Scan template text from `from` (a backtick or a closing `}`) to its end or next `${`. */
  const template = (from: number): void => {
    let j = i;
    while (j < n) {
      const c = src[j];
      if (c === "\\") j += 2;
      else if (c === "`") {
        j++;
        lastSignificant = "`";
        break;
      } else if (c === "$" && src[j + 1] === "{") {
        j += 2;
        braces.push(true);
        lastSignificant = "{";
        break;
      } else j++;
    }
    const stop = Math.min(j, n);
    out += blank(src.slice(from, stop));
    i = stop;
  };

  const regexAllowed = (): boolean => {
    if (!/[\w$)\]]/.test(lastSignificant)) return true;
    if (!/[\w$]/.test(lastSignificant)) return false;
    const word = /[\w$]+$/.exec(out.slice(-16))?.[0] ?? "";
    return REGEX_AFTER_KEYWORD.has(word);
  };

  while (i < n) {
    const two = src.slice(i, i + 2);
    const ch = src[i] ?? "";
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blankAlways(src.slice(i, stop));
      i = stop;
    } else if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += blankAlways(src.slice(i, stop));
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, n);
      out += blank(src.slice(i, stop));
      i = stop;
      lastSignificant = ch;
    } else if (ch === "`") {
      const from = i;
      i++;
      template(from);
    } else if (ch === "{") {
      braces.push(false);
      out += ch;
      lastSignificant = ch;
      i++;
    } else if (ch === "}" && braces.length > 0 && braces[braces.length - 1] === true) {
      braces.pop();
      const from = i;
      i++;
      template(from);
    } else if (ch === "/" && regexAllowed()) {
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
      out += blankAlways(src.slice(i, stop));
      i = stop;
      lastSignificant = "/";
    } else {
      if (ch === "}") braces.pop();
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
  out.push(...checkImports(file, stripNonCode(source, true)));
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
  // `from '...'`, `import('...')`, and the side-effect `import '...'`.
  const pattern =
    /\b(?:import|export)\b[^;]*?\bfrom\s*\(?\s*(['"`])([^'"`]+)\1|\bimport\s*\(\s*(['"`])([^'"`]+)\3|\bimport\s*(['"`])([^'"`]+)\5/g;
  for (const match of code.matchAll(pattern)) {
    const spec = match[2] ?? match[4] ?? match[6];
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
    // Note the source is stripped, not the file on disk: the rules see code
    // only, the import check code plus string literals.
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
