import { CanvasTextMetrics, Container, Graphics, Sprite, type Text } from "pixi.js";
import type { AssetBundle } from "@/assets/AssetLoader.ts";
import {
  drawCard,
  hideFrom,
  monoText,
  place,
  poolAt,
  setText,
  uiText,
} from "@/render/pixi/helpers.ts";
import type { TextureCache } from "@/render/pixi/TextureCache.ts";
import type { PreLaunchLayout } from "@/render/PreLaunchScene.ts";
import {
  debugLines,
  EN_HUD,
  FONTS,
  glideFill,
  HUD,
  HUD_COLOURS,
  HUD_TYPE,
  type HudStrings,
  panelFields,
  promptFor,
} from "@/render/scene/hud.ts";
import { C } from "@/sim/constants.ts";
import type { SimSnapshot } from "@/sim/state.ts";

/** Baselines, so Pixi's top-left text lands where fillText's baseline did. */
interface Ascents {
  readonly debug: number;
  readonly label: number;
  readonly value: number;
  readonly sub: number;
  readonly prompt: number;
}

/**
 * Measured, not assumed: they depend on which face is live, so they are
 * taken again when the strings are re-set after the font has loaded.
 */
function measureAscents(): Ascents {
  const ascent = (font: string): number => CanvasTextMetrics.measureFont(font).ascent;
  return {
    debug: ascent(FONTS.debug),
    label: ascent(FONTS.label),
    value: ascent(FONTS.value),
    sub: ascent(FONTS.sub),
    prompt: ascent(FONTS.prompt),
  };
}

/** One column of the score card: its label over its value. */
interface Field {
  readonly label: Text;
  readonly value: Text;
}

/**
 * The stage-space layer: the original's own HUD art (launch meter, needle,
 * shot pips) plus this port's score card, glide bar, debug readout and
 * prompt. Geometry and strings come from `scene/hud.ts`; this only owns the
 * retained Pixi objects and updates the ones that changed.
 */
export class PixiHud {
  readonly container = new Container();
  #assets: AssetBundle;
  #textures: TextureCache;

  readonly #sceneHud = new Container();
  readonly #scenePool: Sprite[] = [];
  readonly #needle = new Sprite();
  readonly #fields: [Field, Field, Field];
  readonly #glideLabel: Text;
  readonly #glideFill = new Graphics();
  #glideWidth = -1;
  #glideColour = -1;
  readonly #debugBg: Graphics;
  readonly #debugLines: [Text, Text, Text];
  readonly #promptShadow = new Graphics();
  readonly #promptBg = new Graphics();
  readonly #promptText: Text;

  #ascents: Ascents;

  readonly #touch: boolean;
  #strings: HudStrings;

  constructor(
    assets: AssetBundle,
    textures: TextureCache,
    touch = false,
    strings: HudStrings = EN_HUD,
  ) {
    this.#assets = assets;
    this.#touch = touch;
    this.#strings = strings;
    this.#textures = textures;
    this.#ascents = measureAscents();

    const { panel, glide, debug } = HUD;
    const field = (big: boolean): Field => ({
      label: uiText(HUD_TYPE.label, HUD_COLOURS.labelInk),
      value: uiText(
        big ? HUD_TYPE.value : HUD_TYPE.sub,
        big ? HUD_COLOURS.ink : HUD_COLOURS.subInk,
      ),
    });
    this.#fields = [field(true), field(false), field(false)];

    this.#glideLabel = uiText(HUD_TYPE.label, HUD_COLOURS.labelInk);

    this.#debugBg = drawCard(new Graphics(), debug.x, debug.y, debug.w, debug.h, debug.radius);
    this.#debugLines = [
      monoText(HUD_COLOURS.debugInk),
      monoText(HUD_COLOURS.debugInk),
      monoText(HUD_COLOURS.debugInk),
    ];

    this.#promptText = uiText(HUD_TYPE.prompt, HUD_COLOURS.promptInk);
    this.#layoutText();

    this.container.addChild(
      this.#sceneHud,
      this.#needle,
      drawCard(new Graphics(), panel.x, panel.y, panel.w, panel.h, panel.radius),
      ...this.#fields.flatMap((f) => [f.label, f.value]),
      drawCard(
        new Graphics(),
        glide.card.x,
        glide.card.y,
        glide.card.w,
        glide.card.h,
        glide.card.radius,
      ),
      this.#glideLabel,
      new Graphics()
        .roundRect(glide.x, glide.y, glide.w, glide.h, glide.radius)
        .fill({ color: 0x000000, alpha: 0.32 }),
      this.#glideFill,
      this.#debugBg,
      this.#debugLines[0],
      this.#debugLines[1],
      this.#debugLines[2],
      this.#promptShadow,
      this.#promptBg,
      this.#promptText,
    );
  }

  /** The renderer swapped atlases; every texture is looked up again on the next draw. */
  setAssets(assets: AssetBundle, textures: TextureCache): void {
    this.#assets = assets;
    this.#textures = textures;
  }

  setStrings(strings: HudStrings): void {
    this.#strings = strings;
    // The face may have changed under the strings (the font arriving late),
    // so the baselines are measured again rather than trusted.
    this.#ascents = measureAscents();
    this.#layoutText();
    // Forces the texts to re-render and the prompt to re-measure on the next draw.
    for (const f of this.#fields) {
      f.label.text = "";
      f.value.text = "";
    }
    this.#promptText.text = "";
  }

  /** Everything whose position depends on the ascents or the strings. */
  #layoutText(): void {
    const { panel, glide, debug } = HUD;
    for (const [i, f] of this.#fields.entries()) {
      const x = panel.columns[i] ?? panel.x;
      f.label.position.set(x, panel.labelBaseline - this.#ascents.label);
      const ascent = i === 0 ? this.#ascents.value : this.#ascents.sub;
      f.value.position.set(x, panel.valueBaseline - ascent);
    }
    this.#glideLabel.text = this.#strings.glide.toUpperCase();
    this.#glideLabel.position.set(glide.labelX, glide.labelBaseline - this.#ascents.label);
    for (const [i, line] of this.#debugLines.entries()) {
      line.position.set(debug.textX, debug.baseline + i * debug.lineHeight - this.#ascents.debug);
    }
  }

  #drawGlide(fraction: number, colour: number): void {
    const glide = HUD.glide;
    const inner = glide.w - glide.inset * 2;
    // Quarter-pixel steps: a full redraw of the geometry for a change
    // nobody could see is wasted work at 60 fps.
    const width = Math.round(inner * fraction * 4) / 4;
    if (width === this.#glideWidth && colour === this.#glideColour) return;
    this.#glideWidth = width;
    this.#glideColour = colour;
    const g = this.#glideFill.clear();
    if (width <= 0.5) return;
    const x = glide.x + glide.inset;
    const y = glide.y + glide.inset;
    const h = glide.h - glide.inset * 2;
    g.roundRect(x, y, width, h, Math.min(h / 2, width / 2)).fill(colour);
    if (width > 6) {
      g.roundRect(x + 2, y + 1.5, width - 4, 3.5, 1.75).fill({
        color: HUD_COLOURS.gloss,
        alpha: HUD_COLOURS.glossAlpha,
      });
    }
  }

  draw(s: SimSnapshot, scene: PreLaunchLayout, showDebug: boolean): void {
    let used = 0;
    for (const at of scene.hud) {
      const asset = this.#assets.get(at.sprite);
      if (asset === undefined) continue;
      const sprite = poolAt(this.#scenePool, used++, this.#sceneHud, () => new Sprite());
      const texture = this.#textures.get(asset, at.frame);
      if (texture !== undefined) sprite.texture = texture;
      place(sprite, asset, at.x, at.y);
      sprite.visible = true;
    }
    hideFrom(this.#scenePool, used);

    const needle = scene.needle;
    const arrow = needle === null ? undefined : this.#assets.get(needle.sprite);
    this.#needle.visible = needle !== null && arrow !== undefined;
    if (needle !== null && arrow !== undefined) {
      const texture = this.#textures.get(arrow, needle.frame);
      if (texture !== undefined) this.#needle.texture = texture;
      // Rotation is about the registration point, so the offset has to ride on
      // the pivot rather than on the position the way `place` does it.
      this.#needle.position.set(needle.x, needle.y);
      this.#needle.pivot.set(-arrow.meta.ox * arrow.density, -arrow.meta.oy * arrow.density);
      this.#needle.scale.set(1 / arrow.density);
      this.#needle.rotation = needle.flipped ? Math.PI : 0;
    }

    for (const [i, f] of panelFields(s, this.#strings).entries()) {
      const target = this.#fields[i];
      if (target === undefined) continue;
      setText(target.label, f.label);
      setText(target.value, f.value);
    }

    const fill = glideFill(s);
    this.#drawGlide(fill.fraction, fill.colour);

    this.#debugBg.visible = showDebug;
    for (const line of this.#debugLines) line.visible = showDebug;
    if (showDebug) {
      const text = debugLines(s);
      setText(this.#debugLines[0], text[0]);
      setText(this.#debugLines[1], text[1]);
      setText(this.#debugLines[2], text[2]);
    }

    const prompt = promptFor(s, this.#touch, this.#strings);
    const show = prompt !== null;
    this.#promptShadow.visible = show;
    this.#promptBg.visible = show;
    this.#promptText.visible = show;
    // Reading `.width` recomputes the text bounds, so only on a new string.
    if (show && setText(this.#promptText, prompt)) {
      const box = HUD.prompt;
      const width = this.#promptText.width;
      const x = (C.VIEW_W - width) / 2 - box.pad;
      const w = width + box.pad * 2;
      this.#promptShadow
        .clear()
        .roundRect(x, box.y + box.shadowDy, w, box.h, box.h / 2)
        .fill({ color: HUD_COLOURS.shadow, alpha: HUD_COLOURS.shadowAlpha });
      drawCard(this.#promptBg, x, box.y, w, box.h, box.h / 2, HUD_COLOURS.promptAlpha);
      this.#promptText.position.set((C.VIEW_W - width) / 2, box.baseline - this.#ascents.prompt);
    }
  }
}
