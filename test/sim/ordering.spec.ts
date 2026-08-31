import { describe, expect, it } from 'vitest';
import { C } from '@/sim/constants.ts';
import { makeFlight, tick, withActiveTicks } from '../support/harness.ts';

/**
 * These are the fidelity guard. Each one fails if the tick order is rearranged
 * into something that looks tidier, and each corresponds to a divergence found
 * in `reference/legacy/sim.js` - see reference/doc/porting-notes.md.
 */
describe('tick order', () => {
  it('tests the ground before adding gravity, not after', () => {
    // 898.6 + 51 = 949.6, below the ground: no contact this tick.
    // An implementation that added gravity first would test
    // 898.6 + 51.99 = 950.59 and bounce a whole gravity step early.
    const s = makeFlight({ y: 898.6, yvel: 51, xvel: 10 });
    tick(s);
    expect(s.p.hit).toBe(false);
    expect(s.p.y).toBeGreaterThan(C.GROUND_Y);
  });

  it('measures the impact angle from ox/oy, not from the current velocity', () => {
    // Identical xvel/yvel in both cases; only the previous position differs.
    // atan2(yvel, xvel) = atan2(15, 20) = 36.9 degrees would bounce in BOTH,
    // so a faceplant in the second case can only come from ox/oy.
    const shallow = makeFlight({ y: 940, yvel: 15, xvel: 20, ox: 128, oy: 925 });
    tick(shallow);
    expect(shallow.outcome).toBeNull();
    expect(shallow.p.yvel).toBeLessThan(0); // bounced upwards

    const steep = makeFlight({ y: 940, yvel: 15, xvel: 20, ox: 146, oy: 880 });
    tick(steep);
    expect(steep.outcome).toBe('faceplant');
    expect(steep.p.xvel).toBe(0);
  });

  it('applies powerup effects after the bounce, not before', () => {
    // A wind pickup landing on a contact tick must not influence that bounce.
    const withWind = makeFlight({
      y: 945,
      yvel: 20,
      xvel: 30,
      ox: 118,
      oy: 925,
      flags: { wind: true },
    });
    const without = makeFlight({ y: 945, yvel: 20, xvel: 30, ox: 118, oy: 925 });
    tick(withWind);
    tick(without);
    // Same bounce, then wind adds its impulse on top: exactly -8 apart.
    expect(withWind.p.yvel - without.p.yvel).toBeCloseTo(C.WIND_YVEL, 10);
  });

  it('checks the skid threshold before integrating, so it takes two ticks', () => {
    // The predicate needs y from the top of the tick AND the position after
    // gravity, so a tick that *ends* past the threshold still does not skid -
    // the check ran on the pre-move position. Only the next tick can.
    const s = makeFlight({ y: 944, yvel: 3, xvel: 5, hit: true });

    tick(s);
    expect(s.flags.skidding).toBe(false);
    expect(s.p.y).toBeGreaterThanOrEqual(C.SKID_Y); // ...even though it ended past it

    tick(s);
    expect(s.flags.skidding).toBe(true);
  });
});

describe('glide', () => {
  it('freezes the lift at the xvel measured when the button went down', () => {
    // increaseGravity() is called only from onMouseDown (Game.as:1040), so the
    // lift does not track the decaying xvel. sim.js recomputed it every tick.
    const s = makeFlight({ y: 600, xvel: 50, yvel: -5, gravButton: true });
    s.p.setGlideGravity();
    const frozen = C.GLIDE_FACTOR * 50;
    expect(s.p.grav).toBeCloseTo(frozen, 10);

    for (let i = 0; i < 5; i++) tick(s);

    expect(s.p.xvel).toBeLessThan(50); // drag has been working
    expect(s.p.grav).toBeCloseTo(frozen, 10); // ...but the lift has not changed
  });

  it('keeps draining and restores gravity every tick once the meter is empty', () => {
    const s = makeFlight({ y: 600, xvel: 50, yvel: -5, gravButton: true, glidePoints: 10 });
    s.p.setGlideGravity();

    tick(s);
    expect(s.glidePoints).toBe(0);
    expect(s.p.grav).toBeCloseTo(C.GRAV, 10);
    // gravButton stays true - the original never clears it here.
    expect(s.gravButton).toBe(true);

    tick(s);
    expect(s.glidePoints).toBe(0);
    expect(s.p.grav).toBeCloseTo(C.GRAV, 10);
  });

  it('regenerates one point per tick up to the cap', () => {
    const s = makeFlight({ y: 600, xvel: 30, yvel: -5, glidePoints: 40 });
    tick(s);
    expect(s.glidePoints).toBe(41);
    const full = makeFlight({ y: 600, xvel: 30, yvel: -5, glidePoints: C.GLIDE_MAX });
    tick(full);
    expect(full.glidePoints).toBe(C.GLIDE_MAX);
  });
});

describe('powerup guards', () => {
  it('re-applies speed on every overlapping tick - it has no guard', () => {
    // Game.as:719 tests only the hitTest, unlike bounce/slide/rebound. So a
    // two-tick overlap really is +40 xvel, and duration multiplies effect.
    const at = (n: number) => {
      const s = makeFlight({
        y: 600,
        xvel: 0,
        yvel: 0,
        powerups: [{ kind: 'speed', x: 148 - 6.5, y: 600 - 6.25 }],
      });
      tick(s, { tuning: withActiveTicks('speed', n) });
      tick(s, { tuning: withActiveTicks('speed', n) });
      return s.p.xvel;
    };
    const once = at(1);
    const twice = at(2);
    expect(once).toBeCloseTo(20 * C.DRAG * C.DRAG, 6);
    expect(twice).toBeCloseTo((20 * C.DRAG + 20) * C.DRAG, 6);
    expect(twice).toBeGreaterThan(once * 1.9);
  });

  it('arms bounce only once, however long the overlap lasts', () => {
    const s = makeFlight({
      y: 600,
      xvel: 0,
      yvel: 0,
      powerups: [{ kind: 'bounce', x: 148 - 5.9, y: 600 - 5.5 }],
    });
    const tuning = withActiveTicks('bounce', 4);
    const pickups: number[] = [];
    for (let i = 0; i < 4; i++) {
      pickups.push(tick(s, { tuning }).events.filter(e => e.t === 'pickup').length);
    }
    expect(pickups.reduce((a, b) => a + b, 0)).toBe(1);
    expect(s.flags.bounce).toBe(true);
  });

  it('caps the bounce and superbounce rebound velocities', () => {
    const bounce = makeFlight({
      y: 945,
      yvel: 40,
      xvel: 30,
      ox: 118,
      oy: 880,
      flags: { bounce: true },
    });
    tick(bounce);
    // yvel * -0.6 = -24, which is above the -30 floor, so it clamps.
    expect(bounce.p.yvel).toBeCloseTo(C.BOUNCE_Y_MIN + C.GRAV, 10);

    const superb = makeFlight({
      y: 945,
      yvel: 20,
      xvel: 30,
      ox: 118,
      oy: 880,
      flags: { superbounce: true },
    });
    tick(superb);
    // 20 * -1.5 = -30, above the -50 floor, so it clamps too.
    expect(superb.p.yvel).toBeCloseTo(C.SUPERBOUNCE_Y_MIN + C.GRAV, 10);
    expect(superb.p.xvel).toBeCloseTo(30 * (1 + C.BOUNCE_F) * C.DRAG, 10);
  });
});
