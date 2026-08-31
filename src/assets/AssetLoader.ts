import { SPRITES, type SpriteId, type SpriteMeta } from './sprites.generated.ts';

/**
 * Vite resolves this glob at build time, so each sheet gets a content-hashed
 * URL and can be cached immutably - and no filename is ever written by hand.
 * The keys come back as './sprites/sheet-0.png'.
 */
const SHEET_URLS = import.meta.glob<string>('./sprites/sheet-*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** Where one frame sits inside its atlas sheet. */
export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Sprite {
  readonly meta: SpriteMeta;
  readonly frames: readonly FrameRect[];
  /** The atlas this sprite's frames are cut from. */
  readonly sheet: ImageBitmap;
}

export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface AssetBundle {
  get(id: SpriteId): Sprite | undefined;
  /** Every loaded sheet, in index order. One GPU texture each. */
  readonly sheets: readonly ImageBitmap[];
  /** Sheets that failed to load; surfaced in the debug overlay, never fatal. */
  readonly missing: readonly string[];
}

function sheetUrl(index: number): string | undefined {
  return SHEET_URLS[`./sprites/sheet-${index}.png`];
}

async function loadSheet(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return createImageBitmap(await response.blob());
}

/**
 * Loads the atlas sheets the manifest refers to.
 *
 * The 382 frames used to be 382 files fetched one request each - and, worse,
 * awaited sequentially within each sprite, so `hamster/jump` loaded its 36
 * frames one after another. They are one packed sheet now, so this is a single
 * request; several sheets would load in parallel.
 *
 * A sheet that fails is recorded and skipped rather than thrown: a missing
 * asset should cost you the sprites on that sheet, not the whole game.
 */
export async function loadSprites(
  onProgress?: (progress: LoadProgress) => void,
): Promise<AssetBundle> {
  const ids = Object.keys(SPRITES) as SpriteId[];
  const wanted = [...new Set(ids.map(id => SPRITES[id].sheet))].sort((a, b) => a - b);
  const missing: string[] = [];
  let loaded = 0;

  const sheets = await Promise.all(
    wanted.map(async index => {
      const url = sheetUrl(index);
      let bitmap: ImageBitmap | undefined;
      if (url === undefined) {
        missing.push(`sheet-${index} (not in bundle)`);
      } else {
        try {
          bitmap = await loadSheet(url);
        } catch (error) {
          missing.push(`sheet-${index} (${String(error)})`);
        }
      }
      loaded++;
      onProgress?.({ loaded, total: wanted.length });
      return bitmap;
    }),
  );

  const byIndex = new Map<number, ImageBitmap>();
  for (const [at, bitmap] of sheets.entries()) {
    const index = wanted[at];
    if (index !== undefined && bitmap !== undefined) byIndex.set(index, bitmap);
  }

  const sprites = new Map<SpriteId, Sprite>();
  for (const id of ids) {
    const meta = SPRITES[id];
    const sheet = byIndex.get(meta.sheet);
    if (sheet === undefined) continue;
    sprites.set(id, {
      meta,
      sheet,
      frames: meta.rects.map(([x, y]) => ({ x, y, w: meta.w, h: meta.h })),
    });
  }

  return {
    get: id => sprites.get(id),
    sheets: [...byIndex.values()],
    missing,
  };
}
