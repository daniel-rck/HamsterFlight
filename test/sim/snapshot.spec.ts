import { describe, expect, it } from 'vitest';
import { Simulation } from '@/sim/index.ts';

describe('Simulation.snapshot', () => {
  it('hands out a copy of the shot list, not the live array', () => {
    const sim = new Simulation({ seed: 1 });
    // Drive one shot to completion so `shots` has something in it.
    sim.step([{ kind: 'press' }]);
    sim.step([{ kind: 'release' }]);
    for (let i = 0; i < 12; i++) sim.step([]);
    sim.step([{ kind: 'press' }]);
    for (let i = 0; i < 400 && sim.snapshot().shots.length === 0; i++) sim.step([]);

    const taken = sim.snapshot();
    expect(taken.shots.length).toBeGreaterThan(0);
    const before = [...taken.shots];

    // Whatever the simulation does next must not reach into a snapshot already
    // handed out - a HUD holding one would otherwise see it change under it.
    for (let i = 0; i < 600; i++) sim.step([{ kind: 'press' }]);
    expect([...taken.shots]).toEqual(before);
  });

  it('gives a fresh array on every call', () => {
    const sim = new Simulation({ seed: 1 });
    expect(sim.snapshot().shots).not.toBe(sim.snapshot().shots);
  });
});
