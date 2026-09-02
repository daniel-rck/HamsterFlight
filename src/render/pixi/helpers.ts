import { type Container, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type { Sprite as SpriteAsset } from '@/assets/AssetLoader.ts';
import { FONTS, HUD_COLOURS } from '@/render/scene/hud.ts';

/** Small Pixi conveniences with no renderer state, so they can be read alone. */

/**
 * Places a sprite by the manifest's offsets. `w`/`h` are art pixels and
 * `ox`/`oy` stage pixels, so art packed above 1:1 is drawn back down to its
 * stage size and everything stays where Flash put it.
 */
export function place(sprite: Sprite, asset: SpriteAsset, x: number, y: number): void {
  sprite.position.set(x + asset.meta.ox, y + asset.meta.oy);
  sprite.scale.set(1 / asset.density);
}

/** A 1x1 white sprite; set width/height/tint and it is a filled rectangle. */
export function solidRect(): Sprite {
  return new Sprite(Texture.WHITE);
}

export function slab(x: number, y: number, w: number, h: number, tint: number): Sprite {
  const sprite = solidRect();
  sprite.position.set(x, y);
  sprite.width = w;
  sprite.height = h;
  sprite.tint = tint;
  return sprite;
}

/** Translucent HUD chrome at the given rectangle. */
export function chrome(x: number, y: number, w: number, h: number, alpha: number): Sprite {
  const sprite = slab(x, y, w, h, HUD_COLOURS.chrome);
  sprite.alpha = alpha;
  return sprite;
}

/**
 * Opaque at the top, transparent at the bottom. Built once, tinted per frame.
 * Returns null where there is no 2D context to paint it with, so the caller
 * can fall back to a flat sky rather than a silently white one.
 */
export function verticalFadeTexture(): Texture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, 256);
  return Texture.from(canvas);
}

export function monoText(fill: string = HUD_COLOURS.ink): Text {
  return new Text({
    text: '',
    style: new TextStyle({ fontFamily: FONTS.mono, fontSize: 12, fontWeight: '600', fill }),
  });
}

/**
 * Uploading a text texture is expensive; only do it when the string moved.
 * Returns whether it did, so dependent layout can be skipped too.
 */
export function setText(target: Text, value: string): boolean {
  if (target.text === value) return false;
  target.text = value;
  return true;
}

export function poolAt<T extends Container>(
  pool: T[],
  index: number,
  parent: Container,
  make: () => T,
): T {
  let item = pool[index];
  if (item === undefined) {
    item = make();
    pool[index] = item;
    parent.addChild(item);
  }
  return item;
}

export function hideFrom(pool: readonly Container[], from: number): void {
  for (let i = from; i < pool.length; i++) {
    const item = pool[i];
    if (item !== undefined) item.visible = false;
  }
}
