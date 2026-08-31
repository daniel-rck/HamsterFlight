import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetBundle } from '@/assets/AssetLoader.ts';
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

function recordingCanvas(transforms: Transform[]): HTMLCanvasElement {
  const ctx = {
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
    drawImage: () => undefined,
  };
  return { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
}

const EMPTY_ASSETS: AssetBundle = { get: () => undefined, sheets: [], missing: [] };

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
