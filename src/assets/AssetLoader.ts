import { SPRITES, type SpriteId, type SpriteMeta } from './sprites.generated.ts';

/**
 * Vite resolves this glob at build time, so every frame gets a content-hashed
 * URL and can be cached immutably - and no filename is ever written by hand.
 * The keys come back as './sprites/hamster/fly/000.png'.
 */
const FRAME_URLS = import.meta.glob<string>('./sprites/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface Sprite {
  readonly meta: SpriteMeta;
  readonly frames: readonly ImageBitmap[];
}

export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface AssetBundle {
  get(id: SpriteId): Sprite | undefined;
  /** Frames that failed to load; surfaced in the debug overlay, never fatal. */
  readonly missing: readonly string[];
}

function frameUrl(id: SpriteId, index: number): string | undefined {
  return FRAME_URLS[`./sprites/${id}/${String(index).padStart(3, '0')}.png`];
}

async function loadFrame(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return createImageBitmap(await response.blob());
}

/**
 * Loads every sprite frame named in the generated manifest.
 *
 * A frame that fails is recorded and skipped rather than thrown: a missing
 * asset should cost you one sprite, not the whole game.
 */
export async function loadSprites(
  onProgress?: (progress: LoadProgress) => void,
): Promise<AssetBundle> {
  const ids = Object.keys(SPRITES) as SpriteId[];
  const total = ids.reduce((sum, id) => sum + SPRITES[id].frames, 0);
  const sprites = new Map<SpriteId, Sprite>();
  const missing: string[] = [];
  let loaded = 0;

  await Promise.all(
    ids.map(async id => {
      const meta = SPRITES[id];
      const frames: ImageBitmap[] = [];
      for (let index = 0; index < meta.frames; index++) {
        const url = frameUrl(id, index);
        if (url === undefined) {
          missing.push(`${id}/${index} (not in bundle)`);
        } else {
          try {
            frames.push(await loadFrame(url));
          } catch (error) {
            missing.push(`${id}/${index} (${String(error)})`);
          }
        }
        loaded++;
        onProgress?.({ loaded, total });
      }
      if (frames.length > 0) sprites.set(id, { meta, frames });
    }),
  );

  return {
    get: id => sprites.get(id),
    missing,
  };
}
