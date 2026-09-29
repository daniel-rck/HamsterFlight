import { type Container, type Graphics, Matrix, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { Sprite as SpriteAsset } from "@/assets/AssetLoader.ts";
import { FONTS, HUD_COLOURS, type HudType } from "@/render/scene/hud.ts";
import { posePlacement } from "@/render/scene/pose.ts";
import { VIGNETTE, VIGNETTE_STOPS } from "@/render/scene/vignette.ts";

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

/**
 * `place()` at the origin, then the clip's own placement in its parent on top
 * - the flight poses sit in the arrow clip turned or scaled (`posePlacement`).
 * Pixi's `Matrix` is Flash's order, so the manifest's six numbers go straight in.
 */
export function placeInParent(sprite: Sprite, asset: SpriteAsset): void {
  const [a, b, c, d, tx, ty] = posePlacement(asset.meta);
  const inv = 1 / asset.density;
  sprite.setFromMatrix(
    new Matrix(a, b, c, d, tx, ty).append(new Matrix(inv, 0, 0, inv, asset.meta.ox, asset.meta.oy)),
  );
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

/**
 * Opaque at the top, transparent at the bottom. Built once, tinted per frame.
 * Returns null where there is no 2D context to paint it with, so the caller
 * can fall back to a flat sky rather than a silently white one.
 */
export function verticalFadeTexture(): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, 256);
  return Texture.from(canvas);
}

export function monoText(fill: string = HUD_COLOURS.ink): Text {
  return new Text({
    text: "",
    style: new TextStyle({ fontFamily: FONTS.mono, fontSize: 12, fontWeight: "600", fill }),
  });
}

/** HUD text in the port's typeface, at one of the shared `HUD_TYPE` sizes. */
export function uiText(type: HudType, fill: string = HUD_COLOURS.ink): Text {
  return new Text({
    text: "",
    style: new TextStyle({
      fontFamily: FONTS.ui,
      fontSize: type.size,
      fontWeight: type.weight,
      letterSpacing: type.letterSpacing,
      fill,
    }),
  });
}

/**
 * A HUD card into `g`: translucent chrome with a hairline rim, as vector
 * geometry so it stays crisp at any resolution. `g` is cleared first.
 */
export function drawCard(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  alpha: number = HUD_COLOURS.chromeAlpha,
): Graphics {
  const radius = Math.min(r, w / 2, h / 2);
  return g
    .clear()
    .roundRect(x, y, w, h, radius)
    .fill({ color: HUD_COLOURS.chrome, alpha })
    .roundRect(x + 0.5, y + 0.5, w - 1, h - 1, Math.max(0, radius - 0.5))
    .stroke({ color: HUD_COLOURS.rim, alpha: HUD_COLOURS.rimAlpha, width: 1 })
    .moveTo(x + radius, y + 1.5)
    .lineTo(x + w - radius, y + 1.5)
    .stroke({ color: HUD_COLOURS.rim, alpha: HUD_COLOURS.sheenAlpha, width: 1 });
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

/**
 * The vignette's ramp as a white texture, transparent in the middle and opaque
 * at the corners, painted over the unit square and meant to be stretched to
 * the stage and tinted. Null where there is no 2D context.
 */
export function vignetteTexture(): Texture | null {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    VIGNETTE.inner * size,
    size / 2,
    size / 2,
    VIGNETTE.outer * size,
  );
  for (const [offset, share] of VIGNETTE_STOPS) {
    gradient.addColorStop(offset, `rgba(255,255,255,${share})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}
