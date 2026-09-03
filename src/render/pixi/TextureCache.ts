import { ImageSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { Sprite as SpriteAsset } from '@/assets/AssetLoader.ts';

/**
 * One GPU texture per atlas sheet, and one lightweight `Texture` view per frame
 * cut out of it. Because every sprite ends up on the same source, Pixi batches
 * the whole scene into a single draw call - which is the reason an atlas is
 * worth more to this backend than to the Canvas2D one.
 *
 * Frames are views onto the atlas the shared loader already decoded, so both
 * backends consume the identical bitmaps - otherwise the benchmark would be
 * measuring the asset pipeline rather than the renderer.
 *
 * Keyed by asset object and frame index, not by a string of the rect: the old
 * key was built and hashed for every sprite on every frame, about a thousand
 * small allocations a second for a lookup the identity already determines.
 *
 * `cropBottom` - stage px left off the bottom of the frame, which is how the
 * jump clip's painted-on shadow is dropped - is a second dimension of the same
 * cache rather than a second texture built per frame. It is nearly always 0,
 * and the whole game asks for exactly one other value, so the inner map holds
 * one or two entries.
 */
export class TextureCache {
  readonly #sources = new Map<ImageBitmap, TextureSource>();
  readonly #byAsset = new WeakMap<SpriteAsset, Map<number, (Texture | undefined)[]>>();
  readonly #all: Texture[] = [];

  get(asset: SpriteAsset, frame: number, cropBottom = 0): Texture | undefined {
    const index = asset.frames[frame] === undefined ? 0 : frame;
    const rect = asset.frames[index];
    if (rect === undefined) return undefined;
    const height = rect.h - cropBottom * asset.density;
    if (height <= 0) return undefined;

    let byCrop = this.#byAsset.get(asset);
    if (byCrop === undefined) {
      byCrop = new Map();
      this.#byAsset.set(asset, byCrop);
    }
    let frames = byCrop.get(cropBottom);
    if (frames === undefined) {
      frames = [];
      byCrop.set(cropBottom, frames);
    }
    const cached = frames[index];
    if (cached !== undefined) return cached;

    let source = this.#sources.get(asset.sheet);
    if (source === undefined) {
      source = new ImageSource({ resource: asset.sheet });
      this.#sources.set(asset.sheet, source);
    }
    const texture = new Texture({ source, frame: new Rectangle(rect.x, rect.y, rect.w, height) });
    frames[index] = texture;
    this.#all.push(texture);
    return texture;
  }

  destroy(): void {
    for (const texture of this.#all) texture.destroy();
    this.#all.length = 0;
    for (const source of this.#sources.values()) source.destroy();
    this.#sources.clear();
  }
}
