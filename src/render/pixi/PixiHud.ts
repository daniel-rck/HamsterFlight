import { CanvasTextMetrics, Container, Sprite, Text, TextStyle } from 'pixi.js';
import type { AssetBundle } from '@/assets/AssetLoader.ts';
import type { PreLaunchLayout } from '@/render/PreLaunchScene.ts';
import {
  chrome,
  hideFrom,
  monoText,
  place,
  poolAt,
  setText,
  solidRect,
} from '@/render/pixi/helpers.ts';
import type { TextureCache } from '@/render/pixi/TextureCache.ts';
import {
  debugLines,
  FONTS,
  glideFill,
  HUD,
  HUD_COLOURS,
  panelLines,
  promptFor,
} from '@/render/scene/hud.ts';
import { C } from '@/sim/constants.ts';
import type { SimSnapshot } from '@/sim/state.ts';

/**
 * The stage-space layer: the original's own HUD art (launch meter, needle,
 * shot pips) plus this port's panel, glide bar, debug readout and prompt.
 * Geometry and strings come from `scene/hud.ts`; this only owns the retained
 * Pixi objects and updates the ones that changed.
 */
export class PixiHud {
  readonly container = new Container();
  readonly #assets: AssetBundle;
  readonly #textures: TextureCache;

  readonly #sceneHud = new Container();
  readonly #scenePool: Sprite[] = [];
  readonly #needle = new Sprite();
  readonly #panelLines: [Text, Text];
  readonly #glideLabel: Text;
  readonly #glideFill = solidRect();
  readonly #debugBg: Sprite;
  readonly #debugLines: [Text, Text, Text];
  readonly #promptBg: Sprite;
  readonly #promptText: Text;

  /** Baselines, so Pixi's top-left text lands where fillText's baseline did. */
  readonly #ascentMono12: number;
  readonly #ascentSans17: number;

  constructor(assets: AssetBundle, textures: TextureCache) {
    this.#assets = assets;
    this.#textures = textures;

    this.#ascentMono12 = CanvasTextMetrics.measureFont(FONTS.hud).ascent;
    this.#ascentSans17 = CanvasTextMetrics.measureFont(FONTS.prompt).ascent;

    const { panel, glide, debug, prompt } = HUD;
    const alpha = HUD_COLOURS.chromeAlpha;

    this.#panelLines = [monoText(), monoText()];
    this.#panelLines[0].position.set(panel.textX, panel.baseline - this.#ascentMono12);
    this.#panelLines[1].position.set(
      panel.textX,
      panel.baseline + panel.lineHeight - this.#ascentMono12,
    );

    this.#glideLabel = monoText();
    this.#glideLabel.text = 'glide';
    this.#glideLabel.position.set(
      glide.x - this.#glideLabel.width - glide.labelGap,
      glide.labelBaseline - this.#ascentMono12,
    );
    this.#glideFill.position.set(glide.x + 2, glide.fillY);
    this.#glideFill.height = glide.fillH;

    this.#debugBg = chrome(debug.x, debug.y, debug.w, debug.h, alpha);
    this.#debugLines = [
      monoText(HUD_COLOURS.debugInk),
      monoText(HUD_COLOURS.debugInk),
      monoText(HUD_COLOURS.debugInk),
    ];
    for (const [i, line] of this.#debugLines.entries()) {
      line.position.set(debug.textX, debug.baseline + i * debug.lineHeight - this.#ascentMono12);
    }

    this.#promptBg = chrome(0, prompt.y, 0, prompt.h, HUD_COLOURS.promptAlpha);
    this.#promptText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: FONTS.sans,
        fontSize: 17,
        fontWeight: 'bold',
        fill: HUD_COLOURS.promptInk,
      }),
    });

    this.container.addChild(
      this.#sceneHud,
      this.#needle,
      chrome(panel.x, panel.y, panel.w, panel.h, alpha),
      this.#panelLines[0],
      this.#panelLines[1],
      this.#glideLabel,
      chrome(glide.x, glide.y, glide.w + 4, glide.h, alpha),
      this.#glideFill,
      this.#debugBg,
      this.#debugLines[0],
      this.#debugLines[1],
      this.#debugLines[2],
      this.#promptBg,
      this.#promptText,
    );
  }

  draw(s: SimSnapshot, scene: PreLaunchLayout, metric: boolean, showDebug: boolean): void {
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

    const lines = panelLines(s, metric);
    setText(this.#panelLines[0], lines[0]);
    setText(this.#panelLines[1], lines[1]);

    const fill = glideFill(s);
    this.#glideFill.tint = fill.colour;
    this.#glideFill.width = HUD.glide.w * fill.fraction;

    this.#debugBg.visible = showDebug;
    for (const line of this.#debugLines) line.visible = showDebug;
    if (showDebug) {
      const text = debugLines(s);
      setText(this.#debugLines[0], text[0]);
      setText(this.#debugLines[1], text[1]);
      setText(this.#debugLines[2], text[2]);
    }

    const prompt = promptFor(s, metric);
    const show = prompt !== null;
    this.#promptBg.visible = show;
    this.#promptText.visible = show;
    // Reading `.width` recomputes the text bounds, so only on a new string.
    if (show && setText(this.#promptText, prompt)) {
      const box = HUD.prompt;
      const width = this.#promptText.width;
      this.#promptBg.position.set((C.VIEW_W - width) / 2 - box.pad, box.y);
      this.#promptBg.width = width + box.pad * 2;
      this.#promptText.position.set((C.VIEW_W - width) / 2, box.baseline - this.#ascentSans17);
    }
  }
}
