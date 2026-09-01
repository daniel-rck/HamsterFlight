import { describe, expect, it } from 'vitest';
import { launched } from '@/render/PreLaunchScene.ts';

describe('launched', () => {
  it('holds the pillow back for the whole jump', () => {
    // The first click only starts the bob; `launch()` needs a second one.
    expect(launched('ready')).toBe(false);
    expect(launched('jumping')).toBe(false);
  });

  it('keeps the pillow forward until the camera has panned home', () => {
    expect(launched('flying')).toBe(true);
    expect(launched('settling')).toBe(true);
  });

  it('treats game over as parked', () => {
    expect(launched('gameOver')).toBe(false);
  });
});
