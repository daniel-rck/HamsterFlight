import type { InputDevice, Strings } from "@/app/i18n.ts";
import type { Mode } from "@/app/MetaGame.ts";
import { liveStreak, type Progress } from "@/app/progress.ts";
import type { AssetBundle, Sprite } from "@/assets/AssetLoader.ts";
import type { SpriteId } from "@/assets/sprites.generated.ts";
import { ITEM_COLOURS } from "@/render/scene/hud.ts";
import { metres } from "@/render/units.ts";
import type { PowerupKind } from "@/sim/types.ts";

/**
 * The opening screen: the game's name, what to press, what the items do, and
 * the way in - over a still of the scene, before the loop starts.
 *
 * It replaced the original's INSTRUCTIONS board (root frame 6), which was the
 * one place the port showed a raster picture of text: English only, soft on
 * every screen larger than 600 x 400, and silent on touch, keys and pads.
 * Everything here is HTML over the stage and set in the port's typeface, so it
 * is sharp at any size and follows the language. The pictures are the
 * original's own sprites, cut from the atlas the game already loaded.
 */

// -- the model, pure so it can be tested without a DOM --------------------------

export interface IntroChoice {
  readonly label: string;
  readonly sub: string;
}

export interface IntroModel {
  /** The game the page opened for - free, today's challenge, or a duel. */
  readonly primary: IntroChoice;
  /** The other way in: the daily challenge from free play, free play otherwise. */
  readonly secondary: IntroChoice;
  /** The record and the streak, once there is either. */
  readonly stats: string | null;
}

export function introModel(t: Strings, mode: Mode, progress: Progress, today: string): IntroModel {
  const i = t.intro;
  const todaysBest = progress.daily?.day === today ? metres(progress.daily.total) : null;
  const free: IntroChoice = { label: i.freePlay, sub: i.freeSub };
  let primary: IntroChoice;
  let secondary: IntroChoice;
  if (mode.kind === "duel") {
    primary = { label: i.playDuel, sub: i.duelSub(metres(mode.ghost.total)) };
    secondary = free;
  } else if (mode.kind === "daily") {
    primary = { label: i.playDaily, sub: i.dailySub(todaysBest) };
    secondary = free;
  } else {
    primary = { label: i.play, sub: i.playSub };
    secondary = { label: i.daily, sub: i.dailySub(todaysBest) };
  }
  const parts: string[] = [];
  if (progress.bestTotal > 0) parts.push(i.record(metres(progress.bestTotal)));
  const streak = liveStreak(progress, today);
  if (streak > 0) parts.push(i.streak(streak));
  return { primary, secondary, stats: parts.length > 0 ? parts.join("  ·  ") : null };
}

/** The items in the order the original board showed them. */
export const INTRO_ITEMS: readonly PowerupKind[] = [
  "speed",
  "slide",
  "wind",
  "bounce",
  "superbounce",
  "rebound",
];

// -- drawing sprites into small canvases ----------------------------------------

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The part of a frame that has any paint on it, in sheet pixels. Frames are
 * cropped to one box per clip, so a small collectible sits in a lot of air -
 * the propeller is a speck in a 38 x 75 frame - and would draw as a speck.
 */
function paintedBox(sprite: Sprite, frame: number): Box {
  const rect = sprite.frames[frame] ?? sprite.frames[0];
  const whole: Box = rect ?? { x: 0, y: 0, w: 1, h: 1 };
  if (rect === undefined) return whole;
  const probe = document.createElement("canvas");
  probe.width = rect.w;
  probe.height = rect.h;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (ctx === null) return whole;
  ctx.drawImage(sprite.sheet, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, rect.w, rect.h).data;
  } catch {
    return whole;
  }
  let minX = rect.w;
  let minY = rect.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      if ((data[(y * rect.w + x) * 4 + 3] ?? 0) > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return whole;
  return { x: rect.x + minX, y: rect.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Sizes a canvas's backing store to its CSS box at the screen's density. */
function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) ctx.imageSmoothingQuality = "high";
  return ctx;
}

/** `box` scaled to fit `canvas`, centred, `margin` of it left free. */
function drawContained(
  ctx: CanvasRenderingContext2D,
  sheet: ImageBitmap,
  box: Box,
  margin = 0.08,
  dy = 0,
  angle = 0,
): void {
  const { width, height } = ctx.canvas;
  const scale = Math.min((width * (1 - margin * 2)) / box.w, (height * (1 - margin * 2)) / box.h);
  const w = box.w * scale;
  const h = box.h * scale;
  ctx.save();
  ctx.translate(width / 2, height / 2 + dy * height);
  ctx.rotate(angle);
  ctx.drawImage(sheet, box.x, box.y, box.w, box.h, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// -- the view -------------------------------------------------------------------

const STEP_ICONS = [
  // Jump: an arc up and away.
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19c2-9 8-13 15-13"/><path d="M14 3.5 19 6l-2.6 4.8"/></svg>',
  // The pillow: a target.
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke-linecap="round"/></svg>',
  // Glide: a paper plane.
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M21.5 3 2.5 10.6l7 2.8 2.9 7.1L21.5 3z"/><path d="m9.5 13.4 5.2-4.3" stroke-linecap="round"/></svg>',
] as const;

export interface IntroOptions {
  readonly root: HTMLElement;
  readonly strings: Strings;
  readonly device: InputDevice;
  readonly motion: boolean;
  readonly signal: AbortSignal;
  readonly onPlay: () => void;
  readonly onSecondary: () => void;
}

export class Intro {
  readonly #root: HTMLElement;
  readonly #signal: AbortSignal;
  #t: Strings;
  #device: InputDevice;
  #motion: boolean;
  #assets: AssetBundle | null = null;
  #frame = 0;
  #boxes = new Map<string, Box>();

  constructor(o: IntroOptions) {
    this.#root = o.root;
    this.#signal = o.signal;
    this.#t = o.strings;
    this.#device = o.device;
    this.#motion = o.motion;

    this.#el("#intro-play")?.addEventListener("click", o.onPlay, { signal: o.signal });
    this.#el("#intro-alt")?.addEventListener("click", o.onSecondary, { signal: o.signal });
    this.#wireTabs();
    // Tab and Shift+Tab stay inside while it is up: behind it there is only
    // the stage, and the stage is not playable yet.
    o.root.addEventListener("keydown", (e) => this.#trap(e), { signal: o.signal });
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => this.#drawItems());
      observer.observe(o.root);
      o.signal.addEventListener("abort", () => observer.disconnect());
    }
    o.signal.addEventListener("abort", () => cancelAnimationFrame(this.#frame));
  }

  get open(): boolean {
    return !this.#root.hidden;
  }

  show(model: IntroModel): void {
    this.#root.hidden = false;
    this.#root.classList.remove("leaving");
    this.update(model);
    this.#renderSteps();
    this.#drawItems();
    this.#animate();
    this.#el<HTMLButtonElement>("#intro-play")?.focus({ preventScroll: true });
  }

  update(model: IntroModel): void {
    const fill = (id: string, choice: IntroChoice): void => {
      const button = this.#el(id);
      if (button === null) return;
      const label = button.querySelector(".label");
      const sub = button.querySelector("small");
      if (label !== null) label.textContent = choice.label;
      if (sub !== null) sub.textContent = choice.sub;
    };
    fill("#intro-play", model.primary);
    fill("#intro-alt", model.secondary);
    const stats = this.#el("#intro-stats");
    if (stats !== null) {
      stats.textContent = model.stats ?? "";
      stats.hidden = model.stats === null;
    }
  }

  /** Out of the way, with a short fade where motion is welcome. */
  hide(): void {
    cancelAnimationFrame(this.#frame);
    if (!this.#motion) {
      this.#root.hidden = true;
      return;
    }
    this.#root.classList.add("leaving");
    setTimeout(() => {
      this.#root.hidden = true;
      this.#root.classList.remove("leaving");
    }, 240);
  }

  setStrings(t: Strings, model: IntroModel): void {
    this.#t = t;
    this.update(model);
    this.#renderSteps();
    this.#drawItems();
  }

  setDevice(device: InputDevice): void {
    if (device === this.#device) return;
    this.#device = device;
    this.#renderSteps();
  }

  setMotion(motion: boolean): void {
    this.#motion = motion;
    if (this.open) this.#animate();
  }

  /** The sprites to draw with - again whenever a denser atlas arrives. */
  setAssets(assets: AssetBundle): void {
    this.#assets = assets;
    this.#boxes.clear();
    this.#drawItems();
    if (this.open) this.#animate();
  }

  // -- parts ----------------------------------------------------------------------

  #el<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    return this.#root.querySelector<T>(selector);
  }

  #box(id: SpriteId, sprite: Sprite, frame: number): Box {
    const key = `${id}#${frame}`;
    let box = this.#boxes.get(key);
    if (box === undefined) {
      box = paintedBox(sprite, frame);
      this.#boxes.set(key, box);
    }
    return box;
  }

  #renderSteps(): void {
    const i = this.#t.intro;
    const list = this.#el("#intro-steps");
    if (list !== null) {
      list.replaceChildren(
        ...i.steps(this.#device).map(([title, text], n) => {
          const li = document.createElement("li");
          const icon = document.createElement("span");
          icon.className = "step-icon";
          icon.setAttribute("aria-hidden", "true");
          // A constant of this module, never input.
          icon.innerHTML = STEP_ICONS[n] ?? "";
          const body = document.createElement("div");
          const strong = document.createElement("strong");
          strong.textContent = title;
          const p = document.createElement("span");
          p.textContent = text;
          body.append(strong, p);
          li.append(icon, body);
          return li;
        }),
      );
    }
    const keys = this.#el("#intro-keys");
    if (keys !== null) {
      // A finger has no keys to learn; a pad has two.
      const pairs = this.#device === "touch" ? [] : this.#device === "pad" ? i.padKeys : i.keys;
      keys.hidden = pairs.length === 0;
      keys.replaceChildren(
        ...pairs.map(([key, what]) => {
          const span = document.createElement("span");
          const kbd = document.createElement("kbd");
          kbd.textContent = key;
          span.append(kbd, ` ${what}`);
          return span;
        }),
      );
    }
    const items = this.#el("#intro-items");
    if (items !== null && items.childElementCount !== INTRO_ITEMS.length) {
      items.replaceChildren(
        ...INTRO_ITEMS.map((kind) => {
          const li = document.createElement("li");
          li.dataset["kind"] = kind;
          const canvas = document.createElement("canvas");
          canvas.setAttribute("aria-hidden", "true");
          const body = document.createElement("div");
          // The item's minimap colour, so the dots out there can be read.
          const dot = document.createElement("i");
          dot.className = "map-dot";
          dot.setAttribute("aria-hidden", "true");
          dot.style.background = `#${ITEM_COLOURS[kind].toString(16).padStart(6, "0")}`;
          const name = document.createElement("strong");
          body.append(name, document.createElement("span"));
          name.before(dot);
          li.append(canvas, body);
          return li;
        }),
      );
    }
    for (const li of items?.querySelectorAll<HTMLElement>("li") ?? []) {
      const kind = li.dataset["kind"] as PowerupKind | undefined;
      if (kind === undefined) continue;
      const [name, what] = i.items[kind];
      const strong = li.querySelector("strong");
      // The dot sits before the name, outside it, so a rename keeps it.
      const span = li.querySelector("div > span");
      if (strong !== null) strong.textContent = name;
      if (span !== null) span.textContent = what;
    }
  }

  #drawItems(): void {
    const assets = this.#assets;
    if (assets === null || !this.open) return;
    for (const li of this.#root.querySelectorAll<HTMLElement>("#intro-items li")) {
      const kind = li.dataset["kind"] as PowerupKind | undefined;
      const canvas = li.querySelector("canvas");
      if (kind === undefined || canvas === null) continue;
      const id: SpriteId = `powerup/${kind}`;
      const sprite = assets.get(id);
      const ctx = fit(canvas);
      if (sprite === undefined || ctx === null) continue;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawContained(ctx, sprite.sheet, this.#box(id, sprite, 0), 0.06);
    }
  }

  /** The hamster over the menu, flapping and bobbing - one frame without motion. */
  #animate(): void {
    cancelAnimationFrame(this.#frame);
    const canvas = this.#el<HTMLCanvasElement>(".intro-hamster");
    const sprite = this.#assets?.get("hamster/fly");
    if (canvas === null || sprite === undefined) return;
    const fps = sprite.meta.fps ?? 19;
    // One box for every frame, so the wing beat does not resize the hamster:
    // the union of each frame's paint, relative to its own rect.
    const local = sprite.frames.map((rect, n) => {
      const b = this.#box("hamster/fly", sprite, n);
      return { x: b.x - rect.x, y: b.y - rect.y, w: b.w, h: b.h };
    });
    const union = local.reduce<Box>(
      (u, b) => {
        const x = Math.min(u.x, b.x);
        const y = Math.min(u.y, b.y);
        return {
          x,
          y,
          w: Math.max(u.x + u.w, b.x + b.w) - x,
          h: Math.max(u.y + u.h, b.y + b.h) - y,
        };
      },
      local[0] ?? { x: 0, y: 0, w: 1, h: 1 },
    );
    const draw = (now: number): void => {
      if (this.#signal.aborted || !this.open) return;
      const ctx = fit(canvas);
      if (ctx === null) return;
      const n = this.#motion ? Math.floor((now / 1000) * fps) % sprite.frames.length : 0;
      const rect = sprite.frames[n];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (rect !== undefined) {
        const box: Box = { x: rect.x + union.x, y: rect.y + union.y, w: union.w, h: union.h };
        const bob = this.#motion ? Math.sin(now / 420) * 0.05 : 0;
        const tilt = this.#motion ? Math.sin(now / 700) * 0.06 - 0.08 : -0.08;
        drawContained(ctx, sprite.sheet, box, 0.12, bob, tilt);
      }
      if (this.#motion) this.#frame = requestAnimationFrame(draw);
    };
    this.#frame = requestAnimationFrame(draw);
  }

  #wireTabs(): void {
    const tabs = [...this.#root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const select = (tab: HTMLButtonElement, focus: boolean): void => {
      for (const other of tabs) {
        const on = other === tab;
        other.setAttribute("aria-selected", String(on));
        other.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(other.getAttribute("aria-controls") ?? "");
        if (panel !== null) panel.hidden = !on;
      }
      if (focus) tab.focus();
      this.#drawItems();
    };
    for (const [n, tab] of tabs.entries()) {
      tab.addEventListener("click", () => select(tab, false), { signal: this.#signal });
      tab.addEventListener(
        "keydown",
        (e) => {
          const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
          let next: HTMLButtonElement | undefined;
          if (step !== undefined) next = tabs[(n + step + tabs.length) % tabs.length];
          else if (e.key === "Home") next = tabs[0];
          else if (e.key === "End") next = tabs[tabs.length - 1];
          if (next === undefined) return;
          e.preventDefault();
          select(next, true);
        },
        { signal: this.#signal },
      );
    }
  }

  #trap(e: KeyboardEvent): void {
    if (e.key !== "Tab") return;
    const focusable = [
      ...this.#root.querySelectorAll<HTMLElement>("button:not([tabindex='-1']), select"),
    ].filter((el) => el.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
