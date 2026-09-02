import { describe, expect, it } from 'vitest';
import {
  checkImports,
  checkSource,
  checkTree,
  stripNonCode,
} from '../../scripts/check-sim-purity.ts';

/**
 * The purity check guards the property the whole test suite rests on, so it
 * gets a test of its own: what it must reject, what it must let through, and
 * the ways an earlier version could be fooled.
 */
const file = 'src/sim/phases/Example.ts';
const whys = (code: string) => checkSource(file, code).map(v => v.why.split(' - ')[0]);

describe('forbidden globals', () => {
  it('rejects the obvious sources of non-determinism', () => {
    expect(whys('const r = Math.random();')).toContain('Math.random');
    expect(whys('const t = Date.now();')).toContain('Date.now');
    expect(whys('const d = new Date();')).toContain('new Date');
    expect(whys('setTimeout(() => 1, 5);')).toContain('timers');
    expect(whys('const t = performance.now();')).toContain('performance');
    expect(whys('const h = Math.hypot(1, 2);')).toContain('Math.hypot');
  });

  it('rejects the indirections an earlier version missed', () => {
    expect(whys("const r = Math['random']();")).toContain(
      "computed access on Math (Math['random'])",
    );
    expect(whys('crypto.getRandomValues(new Uint32Array(1));')).toContain('crypto');
    expect(whys('const g = globalThis;')).toContain('globalThis');
    expect(whys('const t = process.hrtime();')).toContain('process');
    expect(whys('xs.sort();')).toContain('.sort() without a comparator');
    expect(whys('n.toLocaleString();')).toContain('toLocale*');
  });

  it('matches across a line break, not line by line', () => {
    expect(whys('const r = Math.\n  random();')).toContain('Math.random');
  });

  it('reports the line the match is on', () => {
    const [v] = checkSource(file, 'const a = 1;\nconst b = 2;\nconst r = Math.random();');
    expect(v?.line).toBe(3);
    expect(v?.file).toBe(file);
  });

  it('lets clean code through', () => {
    expect(checkSource(file, 'export function f(x: number): number { return x * 2; }')).toEqual([]);
    expect(whys('xs.sort((a, b) => a - b);')).toEqual([]);
  });
});

describe('comments, strings and regexes', () => {
  it('ignores mentions in comments and strings', () => {
    expect(checkSource(file, '// the original used Math.random and setInterval')).toEqual([]);
    expect(checkSource(file, '/* Date.now()\n performance.now() */')).toEqual([]);
    expect(checkSource(file, "const why = 'Math.random is banned';")).toEqual([]);
    expect(checkSource(file, `const why = \`use \${x} not Date.now\`;`)).toEqual([]);
  });

  it('does not let a quote inside a regex literal swallow the rest of the file', () => {
    // Before regex literals were understood, the `'` opened a string that never
    // closed, and everything after it - including the violation - vanished.
    const code = 'const q = /[\'"]/;\nconst r = Math.random();';
    expect(whys(code)).toContain('Math.random');
  });

  it('keeps line structure while blanking', () => {
    const src = 'a /* two\nlines */ b\n"str" c';
    const out = stripNonCode(src);
    expect(out.split('\n')).toHaveLength(3);
    expect(out).not.toContain('two');
    expect(out).not.toContain('str');
    expect(out).toContain('a');
    expect(out).toContain('c');
  });

  it('still treats division as division', () => {
    expect(checkSource(file, 'const half = total / 2; const r = Math.random();')).toHaveLength(1);
  });
});

describe('import boundary', () => {
  it('allows imports that stay inside src/sim', () => {
    expect(checkImports(file, "import { C } from '../constants.ts';")).toEqual([]);
    expect(checkImports(file, "import type { Rng } from '../rng/Rng.ts';")).toEqual([]);
    expect(checkImports(file, "export { x } from './sibling.ts';")).toEqual([]);
  });

  it('rejects packages, the alias and paths that climb out', () => {
    const why = (code: string) => checkImports(file, code).map(v => v.why);
    expect(why("import { Sprite } from 'pixi.js';")[0]).toContain("imports 'pixi.js'");
    expect(why("import { C } from '@/render/units.ts';")[0]).toContain("'@/render/units.ts'");
    expect(why("import { x } from '../../render/units.ts';")[0]).toContain('leaves src/sim/');
    expect(why("const m = await import('../../app/build.ts');")[0]).toContain('leaves src/sim/');
  });
});

describe('the real tree', () => {
  it('passes, and is not empty', async () => {
    const { files, violations } = await checkTree();
    expect(files).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});
