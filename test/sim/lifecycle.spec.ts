import { describe, expect, it } from 'vitest';
import type { InputCommand } from '@/sim/commands.ts';
import { C } from '@/sim/constants.ts';
import type { SimEvent } from '@/sim/events.ts';
import { Simulation } from '@/sim/Simulation.ts';
import { newCamera } from '@/sim/systems/CameraModel.ts';
import { DEFAULT_TUNING } from '@/sim/tuning.ts';

/** Steps until the phase changes away from `from`, returning every event. */
function stepOut(sim: Simulation, from: string, limit = 10_000): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < limit && sim.phaseKind === from; i++) out.push(...sim.step());
  return out;
}

/** Jump and never swing: the hamster lands back on the pad for a zero. */
function zeroShot(sim: Simulation): SimEvent[] {
  const out = [...sim.step([{ kind: 'press' }, { kind: 'release' }])];
  out.push(...stepOut(sim, 'jumping'));
  return out;
}

/** Jump, connect on `clickTick`, and fly without gliding. */
function flownShot(sim: Simulation, clickTick: number): SimEvent[] {
  const out = [...sim.step([{ kind: 'press' }, { kind: 'release' }])];
  for (let t = 0; t < clickTick; t++) out.push(...sim.step());
  out.push(...sim.step([{ kind: 'press' }, { kind: 'release' }]));
  out.push(...stepOut(sim, 'flying'));
  return out;
}

/**
 * Sweeps the click window until a shot connects and flies to its end, leaving
 * the simulation in `settling`. Throws if no tick connects for the seed.
 */
function connectingShot(seed: number, tuning = DEFAULT_TUNING): Simulation {
  for (let clickTick = 3; clickTick <= 26; clickTick++) {
    const sim = new Simulation({ seed, tuning });
    const events = flownShot(sim, clickTick);
    if (events.some(e => e.t === 'launched') && sim.phaseKind === 'settling') return sim;
  }
  throw new Error(`no click tick connects for seed ${seed}`);
}

describe('command ordering', () => {
  it('applies commands in the order given, so a press before a pause still lands', () => {
    const sim = new Simulation({ seed: 7 });
    sim.step([{ kind: 'press' }, { kind: 'togglePause' }]);
    expect(sim.phaseKind).toBe('jumping');
    expect(sim.snapshot().paused).toBe(true);
    expect(sim.tick).toBe(0);
  });

  it('drops commands that arrive after the pause in the same tick', () => {
    const sim = new Simulation({ seed: 7 });
    const cmds: InputCommand[] = [{ kind: 'togglePause' }, { kind: 'press' }];
    sim.step(cmds);
    expect(sim.phaseKind).toBe('ready');
    expect(sim.tick).toBe(0);
    sim.step([{ kind: 'togglePause' }]);
    expect(sim.snapshot().paused).toBe(false);
    expect(sim.tick).toBe(1);
  });

  it('freezes the tick counter while paused', () => {
    const sim = new Simulation({ seed: 7 });
    sim.step([{ kind: 'togglePause' }]);
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.tick).toBe(0);
  });
});

describe('settling', () => {
  it('holds the outcome clip, then pans the camera home before the next turn', () => {
    const sim = new Simulation({ seed: 0x5eed_0003 });
    let events: SimEvent[] = [];
    // Sweep the click window until one connects; a miss falls through to zero.
    for (let clickTick = 3; clickTick <= 26 && sim.phaseKind !== 'settling'; clickTick++) {
      const fresh = new Simulation({ seed: 0x5eed_0003 });
      events = flownShot(fresh, clickTick);
      if (events.some(e => e.t === 'launched') && fresh.phaseKind === 'settling') {
        return check(fresh, events);
      }
    }
    throw new Error('no click tick connected for this seed');

    function check(s: Simulation, launchEvents: SimEvent[]): void {
      const shotDone = launchEvents.find(e => e.t === 'shotDone');
      expect(shotDone).toBeDefined();
      if (shotDone === undefined || shotDone.t !== 'shotDone') return;
      const hold = DEFAULT_TUNING.outcomeHoldTicks[shotDone.outcome];

      const start = s.snapshot().camera;
      expect(start.x).toBeLessThan(0); // the camera followed the flight

      // Stage one: the clip plays and the camera does not move.
      for (let i = 0; i < hold; i++) {
        s.step();
        expect(s.phaseKind).toBe('settling');
        expect(s.snapshot().camera).toEqual(start);
      }

      // Stage two: geometric convergence towards the launch pad, x rising
      // monotonically, ending exactly where `zero()` would put it.
      let previous = start.x;
      let panTicks = 0;
      while (s.phaseKind === 'settling') {
        s.step();
        panTicks++;
        const cam = s.snapshot().camera;
        if (s.phaseKind === 'settling') expect(cam.x).toBeGreaterThan(previous);
        previous = cam.x;
        expect(panTicks).toBeLessThanOrEqual(DEFAULT_TUNING.camera.maxPanTicks);
      }
      expect(panTicks).toBeGreaterThan(1);
      expect(s.phaseKind).toBe('ready');
      expect(s.snapshot().camera).toEqual(newCamera());
    }
  });

  it('is over in one pan tick when the camera never left home', () => {
    const sim = new Simulation({ seed: 3 });
    zeroShot(sim);
    expect(sim.phaseKind).toBe('settling');
    const hold = DEFAULT_TUNING.outcomeHoldTicks.zero;
    for (let i = 0; i < hold; i++) sim.step();
    expect(sim.phaseKind).toBe('settling');
    sim.step();
    expect(sim.phaseKind).toBe('ready');
  });

  it('gives up on a pan that has not converged after maxPanTicks', () => {
    const cap = 3;
    const tuning = { ...DEFAULT_TUNING, camera: { maxPanTicks: cap } };
    const sim = connectingShot(0x5eed_0003, tuning);
    const outcome = sim.snapshot().outcome;
    expect(outcome).not.toBeNull();
    if (outcome === null) return;
    for (let i = 0; i < DEFAULT_TUNING.outcomeHoldTicks[outcome]; i++) sim.step();
    expect(sim.phaseKind).toBe('settling');
    for (let i = 0; i < cap; i++) sim.step();
    // Released by the cap, not by arrival: the camera is still on its way.
    expect(sim.phaseKind).toBe('ready');
  });
});

describe('session', () => {
  it('ends after five turns and restarts on confirm', () => {
    const sim = new Simulation({ seed: 11 });
    const all: SimEvent[] = [];
    for (let turn = 1; turn <= C.TURNS; turn++) {
      expect(sim.snapshot().turn).toBe(turn);
      all.push(...zeroShot(sim));
      all.push(...stepOut(sim, 'settling'));
    }
    expect(sim.phaseKind).toBe('gameOver');
    const over = all.find(e => e.t === 'gameOver');
    expect(over).toEqual({ t: 'gameOver', total: 0, shots: [0, 0, 0, 0, 0] });
    expect(sim.snapshot().shots).toHaveLength(5);

    // `press` does nothing here; `confirm` starts a new session.
    sim.step([{ kind: 'press' }]);
    expect(sim.phaseKind).toBe('gameOver');
    sim.step([{ kind: 'confirm' }]);
    expect(sim.phaseKind).toBe('ready');
    expect(sim.snapshot().turn).toBe(1);
    expect(sim.snapshot().shots).toEqual([]);
  });

  it('stops the menu music on launch and restarts it for the next hamster', () => {
    const sim = new Simulation({ seed: 0x5eed_0003 });
    let launched: SimEvent[] | null = null;
    for (let clickTick = 3; clickTick <= 26 && launched === null; clickTick++) {
      const fresh = new Simulation({ seed: 0x5eed_0003 });
      const events = flownShot(fresh, clickTick);
      if (events.some(e => e.t === 'launched')) {
        launched = [...events, ...stepOut(fresh, 'settling')];
      }
    }
    expect(launched).not.toBeNull();
    if (launched === null) return;
    const launchAt = launched.findIndex(e => e.t === 'launched');
    const stopPrelude = launched.findIndex(e => e.t === 'sfxStop' && e.id === 'prelude');
    expect(stopPrelude).toBeGreaterThan(launchAt);
    expect(launched.some(e => e.t === 'sfx' && e.id === 'prelude' && e.loop === true)).toBe(true);
    void sim;
  });
});
