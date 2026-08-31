import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetBundle } from '@/assets/AssetLoader.ts';
import { SPRITES } from '@/assets/sprites.generated.ts';
import { Effects } from '@/render/effects/Effects.ts';
import { GameRenderer } from '@/render/GameRenderer.ts';
import { C } from '@/sim/constants.ts';
import type { SimSnapshot } from '@/sim/state.ts';
import { noEffects } from '@/sim/types.ts';

/**
 * The shake maths is covered in effects.spec.ts. What this pins down is the
 * wiring: that the offset reaches the world transform and nothing else, so the
 * HUD cannot drift with it.
 */
type Transform = readonly [number, number, number, number, number, number];

interface Drawn {
  readonly sx: number;
  readonly sy: number;
  readonly alpha: number;
}

function recordingCanvas(transforms: Transform[], drawn: Drawn[] = []): HTMLCanvasElement {
  const ctx = {
    globalAlpha: 1,
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      transforms.push([a, b, c, d, e, f]);
    },
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    measureText: () => ({ width: 10 }),
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    rotate: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    drawImage: (_image: unknown, sx: number, sy: number) => {
      drawn.push({ sx, sy, alpha: ctx.globalAlpha });
    },
  };
  return { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
}

const EMPTY_ASSETS: AssetBundle = { get: () => undefined, sheets: [], missing: [] };

/** Every sprite resolves, each frame at a distinct atlas position. */
function stubAssets(): AssetBundle {
  let at = 0;
  const made = new Map<string, ReturnType<AssetBundle['get']>>();
  return {
    sheets: [],
    missing: [],
    get: id => {
      let sprite = made.get(id);
      if (sprite === undefined) {
        at += 100;
        sprite = {
          meta: SPRITES[id],
          sheet: {} as ImageBitmap,
          frames: [{ x: at, y: at, w: 10, h: 10 }],
        };
        made.set(id, sprite);
      }
      return sprite;
    },
  };
}

function snapshot(): SimSnapshot {
  return {
    tick: 1,
    phaseKind: 'flying',
    turn: 1,
    paused: false,
    hamster: { x: 500, y: 700, xvel: 20, yvel: -10, visible: true, doRotation: true },
    camera: { x: -300, y: 40 },
    powerups: [],
    glidePoints: C.GLIDE_MAX,
    flags: noEffects(),
    shots: [],
    feet: 0,
    outcome: null,
  };
}

/** The world transform is the one carrying a non-zero translation. */
function worldTranslation(transforms: readonly Transform[]): readonly [number, number] {
  const world = transforms.find(t => t[4] !== 0 || t[5] !== 0);
  return world === undefined ? [0, 0] : [world[4], world[5]];
}

describe('impact shake wiring', () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = undefined;
  });

  it('displaces the world by the shake offset and leaves the HUD alone', () => {
    const effects = new Effects({ enhanced: true });
    const transforms: Transform[] = [];
    const renderer = new GameRenderer(recordingCanvas(transforms), EMPTY_ASSETS, effects);

    effects.consume([{ t: 'fx', id: 'superBreak', x: 500, y: 955 }], 0);
    const offset = effects.shakeOffset(40);
    expect(offset).not.toEqual({ x: 0, y: 0 });

    renderer.draw(snapshot(), 40);
    const s = snapshot();
    expect(worldTranslation(transforms)).toEqual([s.camera.x + offset.x, s.camera.y + offset.y]);

    // The HUD is drawn under an untranslated transform, every frame.
    expect(transforms.filter(t => t[4] === 0 && t[5] === 0).length).toBeGreaterThan(0);
  });

  it('leaves the world exactly on the camera when shake is off', () => {
    const effects = new Effects();
    const transforms: Transform[] = [];
    const renderer = new GameRenderer(recordingCanvas(transforms), EMPTY_ASSETS, effects);

    effects.consume([{ t: 'fx', id: 'superBreak', x: 500, y: 955 }], 0);
    renderer.draw(snapshot(), 40);

    const s = snapshot();
    expect(worldTranslation(transforms)).toEqual([s.camera.x, s.camera.y]);
  });
});

describe('the hamster inside the bounce bubble', () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = undefined;
  });

  function bouncing(): SimSnapshot {
    const s = snapshot();
    return { ...s, flags: { ...s.flags, bounce: true } };
  }

  it('draws the flier under a translucent bubble in enhanced mode', () => {
    const drawn: Drawn[] = [];
    const renderer = new GameRenderer(
      recordingCanvas([], drawn),
      stubAssets(),
      new Effects({ enhanced: true }),
    );
    renderer.draw(bouncing(), 0);

    const ball = SPRITES['hamster/ball'];
    const fly = SPRITES['hamster/fly'];
    expect(ball).toBeDefined();
    expect(fly).toBeDefined();
    // Two hamster draws: the flier at full strength, the bubble over it.
    const opaque = drawn.filter(d => d.alpha === 1);
    const faded = drawn.filter(d => d.alpha > 0 && d.alpha < 1);
    expect(faded).toHaveLength(1);
    expect(opaque.length).toBeGreaterThan(0);
  });

  it('draws the bubble alone, fully opaque, in faithful mode', () => {
    const drawn: Drawn[] = [];
    const renderer = new GameRenderer(recordingCanvas([], drawn), stubAssets(), new Effects());
    renderer.draw(bouncing(), 0);

    expect(drawn.filter(d => d.alpha > 0 && d.alpha < 1)).toHaveLength(0);
  });
});
