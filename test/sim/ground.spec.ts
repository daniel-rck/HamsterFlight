import { describe, expect, it } from 'vitest';
import { C } from '@/sim/constants.ts';
import { makeFlight, tick } from '../support/harness.ts';

/**
 * `checkCollision` branch by branch. `ordering.spec.ts` covers the two
 * load-bearing properties (pre-gravity test, ox/oy angle); this pins each arm
 * of the cascade, which had no test of its own.
 */
describe('ground contact', () => {
  it('does nothing while the prediction stays above the ground', () => {
    const s = makeFlight({ y: 900, yvel: 40, xvel: 20 });
    tick(s);
    expect(s.p.hit).toBe(false);
  });

  it('bounces shallow impacts to 949 and halves the descent', () => {
    // 20 + 25 spans two ticks vertically, 30 one tick horizontally: ~56 degrees.
    const s = makeFlight({ y: 945, yvel: 20, xvel: 30, ox: 118, oy: 920 });
    const { events } = tick(s);
    expect(s.p.hit).toBe(true);
    // 949 after the bounce, then the integration adds the new yvel.
    expect(s.p.y).toBeCloseTo(C.BOUNCE_RESET_Y + (20 / C.PLAIN_BOUNCE_Y_DIV + C.GRAV), 10);
    expect(s.p.xvel).toBeCloseTo(30 * C.BOUNCE_F * C.DRAG, 10);
    expect(events).toContainEqual({ t: 'fx', id: 'bounceFx', x: 148, y: 955 });
    expect(events.some(e => e.t === 'sfx' && e.id === 'bump')).toBe(true);
  });

  it('keeps the bounce quiet while skidding', () => {
    const s = makeFlight({
      y: 945,
      yvel: 6,
      xvel: 5,
      ox: 143,
      oy: 940,
      hit: true,
      flags: { skidding: true },
    });
    const { events } = tick(s);
    expect(events.some(e => e.t === 'fx')).toBe(false);
    expect(events.some(e => e.t === 'sfx' && e.id === 'bump')).toBe(false);
  });

  it('faceplants steep impacts and ends the shot on the same tick', () => {
    const s = makeFlight({ y: 945, yvel: 15, xvel: 20, ox: 146, oy: 880 });
    const { events, done } = tick(s);
    expect(done).toBe(true);
    expect(s.outcome).toBe('faceplant');
    // Pinned to the ground, then the tick's gravity still integrates once.
    expect(s.p.y).toBeCloseTo(C.GROUND_Y + C.GRAV, 10);
    expect(s.p.xvel).toBe(0);
    expect(events.some(e => e.t === 'sfx' && e.id === 'hit')).toBe(true);
    expect(events.filter(e => e.t === 'sfxStop' && e.id === 'fly').length).toBeGreaterThan(0);
  });

  it('turns a steep impact while falling into a hole, without the hit cue', () => {
    const s = makeFlight({
      y: 945,
      yvel: 60,
      xvel: 20,
      ox: 146,
      oy: 880,
      flags: { falling: true },
    });
    const { events } = tick(s);
    expect(s.outcome).toBe('hole');
    expect(events.some(e => e.t === 'sfx' && e.id === 'hit')).toBe(false);
  });

  it('lets an armed bounce beat a steep impact - the cascade order is the original', () => {
    const s = makeFlight({ y: 945, yvel: 15, xvel: 20, ox: 146, oy: 880, flags: { bounce: true } });
    const { done, events } = tick(s);
    expect(done).toBe(false);
    expect(s.outcome).toBeNull();
    expect(s.flags.bounce).toBe(false); // consumed
    expect(s.p.hit).toBe(false); // a powered bounce lifts off cleanly
    expect(events).toContainEqual({ t: 'fx', id: 'break', x: 148, y: 955 });
  });

  it('slides instead of bouncing when the skate is latched, keeping the speed', () => {
    const s = makeFlight({ y: 945, yvel: 20, xvel: 30, ox: 118, oy: 920, flags: { slide: true } });
    tick(s);
    expect(s.p.hit).toBe(true);
    expect(s.flags.slide).toBe(true); // latched for the rest of the shot
    expect(s.p.xvel).toBeCloseTo(30 * C.SLIDE_F * C.DRAG, 10);
    // Slides stay on 950, bounces reset to 949.
    expect(s.p.y).toBeCloseTo(C.GROUND_Y + (20 / C.PLAIN_BOUNCE_Y_DIV + C.GRAV), 10);
  });

  it('is skipped entirely on a rebound tick', () => {
    const s = makeFlight({ y: 949, yvel: 30, xvel: 30, flags: { rebound: true } });
    tick(s);
    expect(s.p.hit).toBe(false);
    expect(s.p.yvel).toBeCloseTo(C.REBOUND_YVEL + C.GRAV, 10);
  });

  it('ends the shot when it runs out of speed on the ground', () => {
    const s = makeFlight({ y: C.GROUND_Y, yvel: 0, xvel: 1.005, hit: true });
    const { done, events } = tick(s);
    expect(done).toBe(true);
    expect(s.outcome).toBe('cheer');
    expect(events).toContainEqual({ t: 'sfxStop', id: 'fly' });
  });
});
