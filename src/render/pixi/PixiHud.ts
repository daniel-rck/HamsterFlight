import { CanvasTextMetrics, Container, Graphics, Sprite, type Text } from "pixi.js";
import type { AssetBundle } from "@/assets/AssetLoader.ts";
import { drawCard, monoText, place, setText, uiText } from "@/render/pixi/helpers.ts";
import type { TextureCache } from "@/render/pixi/TextureCache.ts";
import {
  debugLines,
  EN_HUD,
  FONTS,
  glideFill,
  HUD,
  HUD_COLOURS,
  HUD_TYPE,
  type HudStrings,
  ITEM_COLOURS,
  type LaunchZones,
  meterBands,
  meterReading,
  minimapModel,
  panelFields,
  pipFrames,
  promptFor,
  triesLabel,
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
 * The stage-space layer: the bar across the top (tries, launch meter,
 * distances, glide), the minimap, the debug readout and the prompt. Geometry
 * and strings come from `scene/hud.ts`; this only owns the retained Pixi
 * objects and updates the ones that changed.
 */
export class PixiHud {
  readonly container = new Container();
  #assets: AssetBundle;
  #textures: TextureCache;
  readonly #zones: LaunchZones;

  readonly #triesLabel: Text;
  readonly #pips: Sprite[] = [];
  readonly #meter = new Container();
  readonly #meterLabel: Text;
  readonly #knob = new Graphics();
  #knobAt = Number.NaN;
  #knobLit = false;
  readonly #fields: [Field, Field];
  readonly #glideLabel: Text;
  readonly #glideFill = new Graphics();
  #glideWidth = -1;
  #glideColour = -1;
  readonly #map = new Container();
  readonly #mapMarks = new Graphics();
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
    zones: LaunchZones,
    touch = false,
    strings: HudStrings = EN_HUD,
  ) {
    this.#assets = assets;
    this.#touch = touch;
    this.#strings = strings;
    this.#textures = textures;
    this.#zones = zones;
    this.#ascents = measureAscents();

    const { bar, meter, glide, debug, minimap } = HUD;
    const label = (): Text => uiText(HUD_TYPE.label, HUD_COLOURS.labelInk);
    const field = (big: boolean): Field => ({
      label: label(),
      value: uiText(
        big ? HUD_TYPE.value : HUD_TYPE.sub,
        big ? HUD_COLOURS.ink : HUD_COLOURS.subInk,
      ),
    });
    this.#triesLabel = label();
    this.#meterLabel = label();
    this.#fields = [field(true), field(false)];
    this.#glideLabel = label();
    for (let i = 0; i < C.TURNS; i++) this.#pips.push(new Sprite());

    const frame = drawCard(new Graphics(), bar.x, bar.y, bar.w, bar.h, bar.radius);
    for (const x of HUD.dividers) {
      frame
        .rect(x, bar.y + 9, 1, bar.h - 18)
        .fill({ color: HUD_COLOURS.divider, alpha: HUD_COLOURS.dividerAlpha });
    }

    // The meter's track and bands never change, only the knob does.
    const track = new Graphics()
      .roundRect(meter.x, meter.y, meter.w, meter.h, meter.radius)
      .fill({ color: 0x000000, alpha: 0.32 });
    const bands = new Graphics();
    for (const band of meterBands(zones)) {
      bands.rect(band.x, meter.y, band.w, meter.h).fill({ color: band.colour, alpha: band.alpha });
    }
    const clip = new Graphics()
      .roundRect(meter.x, meter.y, meter.w, meter.h, meter.radius)
      .fill(0xffffff);
    bands.mask = clip;
    this.#meter.addChild(this.#meterLabel, track, bands, clip, this.#knob);

    this.#map.addChild(
      drawCard(
        new Graphics(),
        minimap.x,
        minimap.y,
        minimap.w,
        minimap.h,
        minimap.radius,
        HUD_COLOURS.mapAlpha,
      ),
      this.#mapMarks,
    );
    this.#map.visible = false;

    this.#debugBg = drawCard(new Graphics(), debug.x, debug.y, debug.w, debug.h, debug.radius);
    this.#debugLines = [
      monoText(HUD_COLOURS.debugInk),
      monoText(HUD_COLOURS.debugInk),
      monoText(HUD_COLOURS.debugInk),
    ];

    this.#promptText = uiText(HUD_TYPE.prompt, HUD_COLOURS.promptInk);
    this.#layoutText();

    this.container.addChild(
      frame,
      this.#triesLabel,
      ...this.#pips,
      this.#meter,
      ...this.#fields.flatMap((f) => [f.label, f.value]),
      this.#glideLabel,
      new Graphics()
        .roundRect(glide.x, glide.y, glide.w, glide.h, glide.radius)
        .fill({ color: 0x000000, alpha: 0.32 }),
      this.#glideFill,
      this.#map,
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
    for (const text of [this.#triesLabel, ...this.#fields.flatMap((f) => [f.label, f.value])]) {
      text.text = "";
    }
    this.#promptText.text = "";
  }

  /** Everything whose position depends on the ascents or the strings. */
  #layoutText(): void {
    const { tries, meter, panel, glide, debug, labelBaseline, valueBaseline } = HUD;
    const top = labelBaseline - this.#ascents.label;
    this.#triesLabel.position.set(tries.labelX, top);
    this.#meterLabel.text = this.#strings.launchLabel.toUpperCase();
    this.#meterLabel.position.set(meter.labelX, top);
    for (const [i, f] of this.#fields.entries()) {
      const x = panel.columns[i] ?? panel.columns[0];
      f.label.position.set(x, top);
      const ascent = i === 0 ? this.#ascents.value : this.#ascents.sub;
      f.value.position.set(x, valueBaseline - ascent);
    }
    this.#glideLabel.text = this.#strings.glide.toUpperCase();
    this.#glideLabel.position.set(glide.labelX, top);
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

  #drawMeter(s: SimSnapshot): void {
    const meter = HUD.meter;
    const reading = meterReading(s, this.#zones);
    this.#meter.alpha = reading.up ? 1 : 0.4;
    this.#knob.visible = reading.up;
    if (!reading.up) return;
    const at = Math.round(reading.fraction * meter.w * 4) / 4;
    if (at === this.#knobAt && reading.inBand === this.#knobLit) return;
    this.#knobAt = at;
    this.#knobLit = reading.inBand;
    const x = meter.x + at;
    const y = meter.y + meter.h / 2;
    const g = this.#knob.clear();
    if (reading.inBand) {
      g.circle(x, y, meter.knob + 3).fill({ color: HUD_COLOURS.meterBand, alpha: 0.45 });
    }
    g.circle(x, y + 1, meter.knob).fill({
      color: HUD_COLOURS.shadow,
      alpha: HUD_COLOURS.shadowAlpha,
    });
    g.circle(x, y, meter.knob).fill(HUD_COLOURS.meterKnob);
  }

  #drawMap(s: SimSnapshot): void {
    const map = minimapModel(s);
    this.#map.visible = map !== null;
    if (map === null) return;
    const m = HUD.minimap;
    const g = this.#mapMarks.clear();
    if (map.groundY !== null) {
      g.rect(m.x + 2, map.groundY, m.w - 4, 1.5).fill({
        color: HUD_COLOURS.mapGround,
        alpha: 0.55,
      });
    }
    g.rect(map.view.x + 0.5, map.view.y + 0.5, map.view.w - 1, map.view.h - 1).stroke({
      color: HUD_COLOURS.mapView,
      alpha: HUD_COLOURS.mapViewAlpha,
      width: 1,
    });
    for (const item of map.items) {
      g.circle(item.x, item.y, m.dot).fill({
        color: ITEM_COLOURS[item.kind],
        alpha: item.beyond ? HUD_COLOURS.mapBeyondAlpha : 1,
      });
    }
    g.circle(map.hamster.x, map.hamster.y, m.dot + 0.8)
      .fill(HUD_COLOURS.mapHamster)
      .stroke({ color: HUD_COLOURS.chrome, width: 1.2 });
  }

  draw(s: SimSnapshot, showDebug: boolean): void {
    setText(this.#triesLabel, triesLabel(s, this.#strings));
    const pip = this.#assets.get("hud/shotPip");
    const tries = HUD.tries;
    for (const [i, frame] of pipFrames(s).entries()) {
      const sprite = this.#pips[i];
      if (sprite === undefined) continue;
      const texture = pip === undefined ? undefined : this.#textures.get(pip, frame);
      sprite.visible = texture !== undefined;
      if (pip === undefined || texture === undefined) continue;
      sprite.texture = texture;
      place(sprite, pip, tries.pipX + i * tries.pipStep - pip.meta.ox, tries.pipY - pip.meta.oy);
    }

    this.#drawMeter(s);

    for (const [i, f] of panelFields(s, this.#strings).entries()) {
      const target = this.#fields[i];
      if (target === undefined) continue;
      setText(target.label, f.label);
      setText(target.value, f.value);
    }

    const fill = glideFill(s);
    this.#drawGlide(fill.fraction, fill.colour);
    this.#drawMap(s);

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
