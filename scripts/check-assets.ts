// The atlas is a build artifact that CI cannot rebuild.
//
// `sprites.generated.ts` and `sprites/*.png` come out of
// reference/tools/build_sprites.py, which needs the original SWF - and the SWF
// is gitignored and must never be committed. So nothing downstream can
// regenerate them and compare. What it can do is check that the manifest and
// the sheets still agree with each other, which catches the whole class of
// "someone edited the generated file" and "the packer moved something".
//
// The sharpest of these is the sheet bound. `pack_atlas` crops the last sheet
// to exactly the lowest occupied row, so the bottom rect ends on the final
// pixel of the PNG with nothing to spare. A rect one pixel lower would sample
// past the end of the texture, and until now nothing would have said so.
//
//   node scripts/check-assets.ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, run } from './lib/cli.ts';

const MANIFEST = join(ROOT, 'src/assets/sprites.generated.ts');
const SHEETS = join(ROOT, 'src/assets/sprites');
const SOURCES = join(ROOT, 'src');

interface Size {
  readonly w: number;
  readonly h: number;
}

interface Entry {
  readonly name: string;
  readonly w: number;
  readonly h: number;
  readonly frames: number;
  readonly sheet: number;
  readonly rects: readonly { readonly x: number; readonly y: number }[];
}

/** Width and height out of a PNG's IHDR, without decoding it. */
function pngSize(bytes: Buffer): Size | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

/**
 * Read the manifest as text rather than importing it.
 *
 * Importing would drag the whole `src/assets` module graph into a check that
 * runs before the typecheck step - it is the cheap gate. The shape is
 * machine-generated and stable, so a regex over it is honest rather than
 * fragile: if the generator ever changes the shape, `entries.length` drops to
 * zero and the check below says so instead of silently passing.
 */
function parseManifest(text: string): { entries: Entry[]; densities: number[] } {
  const body = text.slice(text.indexOf('export const SPRITES = {'));
  const entries: Entry[] = [];
  const pattern = /\n {2}'?([\w/]+)'?: \{\n([\s\S]*?)\n {2}\},/g;
  for (const match of body.matchAll(pattern)) {
    const name = match[1] ?? '';
    const fields = match[2] ?? '';
    const number = (key: string): number => {
      const found = fields.match(new RegExp(`\\b${key}: (-?[\\d.]+)`));
      return found?.[1] === undefined ? Number.NaN : Number(found[1]);
    };
    const rects = [...fields.matchAll(/\[(\d+),\s*(\d+)\]/g)].map(([, x, y]) => ({
      x: Number(x),
      y: Number(y),
    }));
    entries.push({
      name,
      w: number('w'),
      h: number('h'),
      frames: number('frames'),
      sheet: number('sheet'),
      rects,
    });
  }
  const densities = text.match(/export const DENSITIES = \[([\d, ]+)\]/);
  return {
    entries,
    densities:
      densities?.[1] === undefined ? [1] : densities[1].split(',').map(part => Number(part.trim())),
  };
}

/**
 * Sprite ids the renderers build at runtime and cast with `as SpriteId`.
 *
 * The generated `SpriteId` union normally makes a typo a compile error, and a
 * template literal with a cast is precisely the hole in that. The bushes used
 * to be built this way; they are a typed table now, but the check stays so a
 * new one cannot creep in unnoticed.
 */
const DYNAMIC_ID = /`([\w/]*)\$\{[^}]+\}`\s+as\s+SpriteId/g;

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (item.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

const sheetFile = (index: number, density: number): string =>
  `sheet-${index}${density === 1 ? '' : `@${density}x`}.png`;

async function main(): Promise<void> {
  const problems: string[] = [];
  const note = (message: string): number => problems.push(message);

  const { entries, densities } = parseManifest(await readFile(MANIFEST, 'utf8'));
  if (entries.length === 0) {
    note(`${MANIFEST}: parsed no sprites - has the generator's output shape changed?`);
    reportProblems(problems);
    return;
  }
  const sheetIndices = [...new Set(entries.map(entry => entry.sheet))];

  // Sheet dimensions, per density.
  const sizes = new Map<string, Size>();
  for (const density of densities) {
    for (const index of sheetIndices) {
      const file = sheetFile(index, density);
      let size: Size | null = null;
      try {
        size = pngSize(await readFile(join(SHEETS, file)));
      } catch {
        note(`${file}: referenced by the manifest but missing from src/assets/sprites/`);
        continue;
      }
      if (size === null) note(`${file}: not a PNG`);
      else sizes.set(`${index}@${density}`, size);
    }
  }

  // The other direction: a sheet nobody references still ships, at ~800 kB.
  const expected = new Set(densities.flatMap(d => sheetIndices.map(i => sheetFile(i, d))));
  for (const file of await readdir(SHEETS)) {
    if (/^sheet-.*\.png$/.test(file) && !expected.has(file)) {
      note(`${file}: in src/assets/sprites/ but no manifest entry points at it - stale pack?`);
    }
  }

  // A denser sheet is the same layout multiplied, which is the whole reason one
  // set of rects can serve every density. If it is not exactly double, every
  // frame on it is drawn from the wrong place.
  for (const index of sheetIndices) {
    const base = sizes.get(`${index}@1`);
    if (base === undefined) continue;
    for (const density of densities.filter(d => d !== 1)) {
      const scaled = sizes.get(`${index}@${density}`);
      if (scaled === undefined) continue;
      if (scaled.w !== base.w * density || scaled.h !== base.h * density) {
        note(
          `sheet-${index}@${density}x is ${scaled.w}x${scaled.h}, not ${density}x ` +
            `${base.w}x${base.h} - the shared layout does not survive the multiply`,
        );
      }
    }
  }

  for (const entry of entries) {
    if (entry.rects.length !== entry.frames) {
      note(
        `${entry.name}: frames says ${entry.frames} but there are ` +
          `${entry.rects.length} rects (duplicates share a rect, the count still has to match)`,
      );
    }
    const sheet = sizes.get(`${entry.sheet}@1`);
    if (sheet === undefined) continue;
    for (const [at, rect] of entry.rects.entries()) {
      if (rect.x + entry.w > sheet.w || rect.y + entry.h > sheet.h) {
        note(
          `${entry.name}[${at}]: ${entry.w}x${entry.h} at (${rect.x}, ${rect.y}) runs past ` +
            `sheet-${entry.sheet} (${sheet.w}x${sheet.h})`,
        );
      }
    }
  }

  // Ids built at runtime and cast past the union.
  const names = entries.map(entry => entry.name);
  for (const file of await sourceFiles(SOURCES)) {
    const text = await readFile(file, 'utf8');
    for (const [, prefix] of text.matchAll(DYNAMIC_ID)) {
      if (prefix === undefined || prefix === '') continue;
      if (!names.some(name => name.startsWith(prefix))) {
        note(`${file}: builds \`${prefix}\${...}\` as SpriteId, and no sprite starts with that`);
      }
    }
  }

  if (problems.length > 0) {
    reportProblems(problems);
    return;
  }
  const frames = entries.reduce((total, entry) => total + entry.frames, 0);
  const rects = new Set(entries.flatMap(e => e.rects.map(r => `${e.sheet}:${r.x},${r.y}`))).size;
  console.log(
    `Checked ${entries.length} sprites / ${frames} frames (${rects} distinct rects) on ` +
      `${sheetIndices.length} sheet(s) at ${densities.join('x, ')}x.`,
  );
}

function reportProblems(problems: readonly string[]): void {
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n${problems.length} atlas problem(s).`);
  process.exitCode = 1;
}

run(main);
