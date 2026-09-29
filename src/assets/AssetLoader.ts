import { DENSITIES, SPRITES, type SpriteId, type SpriteMeta } from "./sprites.generated.ts";

/**
 * Vite resolves this glob at build time, so each sheet gets a content-hashed
 * URL and can be cached immutably - and no filename is ever written by hand.
 * The keys come back as './sprites/sheet-0.png'.
 */
const SHEET_URLS = import.meta.glob<string>("./sprites/sheet-*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

/**
 * Which atlas to fetch. The sheets share one layout, so a denser one is the
 * same rectangles multiplied - the smallest that still covers the display wins,
 * and a 1x screen never pays for art it cannot show.
 *
 * `scale` is sheet pixels per stage pixel actually needed - `stageScale()`,
 * which folds the layout width in with the device pixel ratio.
 */
export function densityFor(scale: number): number {
  const covering = DENSITIES.find((density) => density >= scale);
  return covering ?? DENSITIES[DENSITIES.length - 1] ?? 1;
}

/** Where one frame sits inside its atlas sheet. */
export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Sprite {
  readonly meta: SpriteMeta;
  /** In sheet pixels, so already multiplied by `density`. */
  readonly frames: readonly FrameRect[];
  /** The atlas this sprite's frames are cut from. */
  readonly sheet: ImageBitmap;
  /** Sheet pixels per stage pixel; the renderer draws back down by this. */
  readonly density: number;
}

export interface LoadProgress {
  /** Sheets finished, of all wanted. */
  readonly loaded: number;
  readonly total: number;
  /**
   * How far the download is, 0 to 1, by bytes - or null while a sheet's size
   * is unknown (no Content-Length, or a body the browser will not stream).
   * The page's one atlas is ~2 MB at 2x, so sheets finished alone would say
   * nothing until it was all there.
   */
  readonly fraction: number | null;
}

export interface AssetBundle {
  get(id: SpriteId): Sprite | undefined;
  /** Every loaded sheet, in index order. One GPU texture each. */
  readonly sheets: readonly ImageBitmap[];
  /** The density actually loaded. */
  readonly density: number;
  /** Sheets that failed to load. Not fatal here; the caller decides whether to retry. */
  readonly missing: readonly string[];
}

function sheetUrl(index: number, density: number): string | undefined {
  const suffix = density === 1 ? "" : `@${density}x`;
  return SHEET_URLS[`./sprites/sheet-${index}${suffix}.png`];
}

/** A stalled connection used to leave "loading…" up forever. */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * The response body as a blob, reporting bytes as they arrive. Falls back to
 * a plain `blob()` - and no reports - when the size is not announced or the
 * body cannot be streamed.
 */
async function readWithProgress(
  response: Response,
  onBytes: (loaded: number, total: number) => void,
): Promise<Blob> {
  const total = Number(response.headers.get("content-length") ?? "");
  const body = response.body;
  if (!(total > 0) || body === null || typeof body.getReader !== "function") {
    return response.blob();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onBytes(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    // An encoded response announces the encoded size and streams the decoded
    // bytes, so the count may overshoot; the bar just stops at full.
    onBytes(Math.min(loaded, total), total);
  }
  return new Blob(chunks as BlobPart[], {
    type: response.headers.get("content-type") ?? "image/png",
  });
}

async function loadSheet(
  url: string,
  onBytes: (loaded: number, total: number) => void = () => undefined,
): Promise<ImageBitmap> {
  // AbortController + setTimeout rather than `AbortSignal.timeout`, which
  // older browsers lack; a missing static would throw before the fetch and
  // before the 1x retry ever got a chance.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timed out")), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await createImageBitmap(await readWithProgress(response, onBytes));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads the atlas sheets the manifest refers to.
 *
 * The frames used to be one file each, fetched one request apiece - and, worse,
 * awaited sequentially within each sprite, so `hamster/jump` loaded its 36
 * frames one after another. They are one packed sheet now, so this is a single
 * request; several sheets would load in parallel.
 *
 * A sheet that fails is recorded and skipped rather than thrown: a missing
 * asset should cost you the sprites on that sheet, not the whole game.
 */
export async function loadSprites(
  onProgress?: (progress: LoadProgress) => void,
  density = 1,
): Promise<AssetBundle> {
  const ids = Object.keys(SPRITES) as SpriteId[];
  const wanted = [...new Set(ids.map((id) => SPRITES[id].sheet))].sort((a, b) => a - b);
  const missing: string[] = [];
  let loaded = 0;
  // Bytes per sheet as they arrive; a sheet with no entry has not said its size.
  const bytes = new Map<number, { loaded: number; total: number }>();
  const fraction = (): number | null => {
    if (loaded === wanted.length) return 1;
    let done = 0;
    let all = 0;
    for (const index of wanted) {
      const b = bytes.get(index);
      if (b === undefined) return null;
      done += b.loaded;
      all += b.total;
    }
    return all > 0 ? done / all : null;
  };

  const sheets = await Promise.all(
    wanted.map(async (index) => {
      const url = sheetUrl(index, density);
      let bitmap: ImageBitmap | undefined;
      if (url === undefined) {
        missing.push(`sheet-${index} (not in bundle)`);
      } else {
        try {
          bitmap = await loadSheet(url, (done, total) => {
            bytes.set(index, { loaded: done, total });
            onProgress?.({ loaded, total: wanted.length, fraction: fraction() });
          });
        } catch (error) {
          missing.push(`sheet-${index} (${String(error)})`);
        }
      }
      loaded++;
      onProgress?.({ loaded, total: wanted.length, fraction: fraction() });
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
      density,
      frames: meta.rects.map(([x, y]) => ({
        x: x * density,
        y: y * density,
        w: meta.w * density,
        h: meta.h * density,
      })),
    });
  }

  return {
    get: (id) => sprites.get(id),
    sheets: [...byIndex.values()],
    density,
    missing,
  };
}
