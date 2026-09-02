import { describe, expect, it } from 'vitest';
import type { InputCommand } from '@/sim/commands.ts';
import { C } from '@/sim/constants.ts';
import type { SimEvent } from '@/sim/events.ts';
import { Simulation } from '@/sim/Simulation.ts';
import { newCamera, quickPanStep } from '@/sim/systems/CameraModel.ts';
import { DEFAULT_TUNING } from '@/sim/tuning.ts';

/** Steps until the phase changes away from `from`, returning every event. */
function stepOut(sim: Simulation, from: string, limit = 10_000): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < limit && sim.phaseKind === from; i++) out.push(...sim.step());
  return out;
}

/** Jump and never swing: the hamster lands back on the pad, turn intact. */
function failedJump(sim: Simulation): SimEvent[] {
  const out = [...sim.step([{ kind: 'press' }, { kind: 'release' }])];
  out.push(...stepOut(sim, 'jumping'));
  return out;
}

/**
 * True when the jump core overlaps the pillow, i.e. a swing on this tick
 * connects. The x axis can never fail, so this is the whole test - see
 * `attemptLaunch`.
 */
function inWindow(y: number): boolean {
  const core = DEFAULT_TUNING.boxes.hamsterJumpCore;
  const pillow = DEFAULT_TUNING.boxes.pillow;
  return Math.abs(y + core.cy - (C.PILLOW_Y + pillow.cy)) <= core.hh + pillow.hh;
}

/**
 * Play one whole turn on this simulation: jump, swing on the first tick that
 * connects, fly to the end. A jump that cannot reach the pillow costs nothing
 * now, so the retry is just another jump with a fresh roll.
 */
function playTurn(sim: Simulation, attempts = 40): SimEvent[] {
  const out: SimEvent[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    out.push(...sim.step([{ kind: 'press' }, { kind: 'release' }]));
    while (sim.phaseKind === 'jumping') {
      if (inWindow(sim.snapshot().hamster.y)) {
        out.push(...sim.step([{ kind: 'press' }, { kind: 'release' }]));
        break;
      }
      out.push(...sim.step());
    }
    if (sim.phaseKind === 'flying') {
      out.push(...stepOut(sim, 'flying'));
      return out;
    }
    out.push(...stepOut(sim, 'jumping'));
  }
  throw new Error('no jump connected');
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

describe('a jump that never meets the pillow', () => {
  it('hands the turn back instead of scoring a zero', () => {
    const sim = new Simulation({ seed: 3 });
    const events = failedJump(sim);
    expect(sim.phaseKind).toBe('ready');
    expect(events.some(e => e.t === 'jumpFailed')).toBe(true);
    expect(events.some(e => e.t === 'shotDone')).toBe(false);
    expect(sim.snapshot().turn).toBe(1);
    expect(sim.snapshot().shots).toEqual([]);
  });

  it('can be tried again from the pad', () => {
    const sim = new Simulation({ seed: 3 });
    failedJump(sim);
    sim.step([{ kind: 'press' }, { kind: 'release' }]);
    expect(sim.phaseKind).toBe('jumping');
    expect(sim.snapshot().turn).toBe(1);
  });

  it('swings once per jump, so a whiff cannot be mashed away', () => {
    const sim = new Simulation({ seed: 7 });
    sim.step([{ kind: 'press' }, { kind: 'release' }]);
    // Straight off the pad the hamster is far below the pillow, so this whiffs.
    const first = sim.step([{ kind: 'press' }, { kind: 'release' }]);
    expect(first.some(e => e.t === 'missed')).toBe(true);

    // Every later press during the same jump is swallowed, including the ones
    // that fall inside the window.
    let swings = 0;
    while (sim.phaseKind === 'jumping') {
      const events = sim.step([{ kind: 'press' }, { kind: 'release' }]);
      if (events.some(e => e.t === 'missed' || e.t === 'launched')) swings++;
    }
    expect(swings).toBe(0);
    expect(sim.phaseKind).toBe('ready');
  });
});

describe('where the outcome clip goes', () => {
  it('stays at the landing site, not back at the launcher', () => {
    const sim = connectingShot(0x5eed_0003);
    expect(sim.phaseKind).toBe('settling');
    const landed = sim.snapshot();
    // Far downrange: the shot scored, so it cannot have come down on the pad.
    expect(landed.feet).toBeGreaterThan(0);
    expect(landed.hamster.x).toBeGreaterThan(C.HAMSTER_X);
    // The score is `floor(x / 100)`, so the drawn x sits inside that foot.
    expect(landed.hamster.x).toBeGreaterThanOrEqual(landed.feet * C.PX_PER_FOOT);
    expect(landed.hamster.x).toBeLessThan((landed.feet + 1) * C.PX_PER_FOOT);
    // A faceplant or a hole is parked on the ground line; a `cheer` keeps
    // whatever y the last integration left, exactly as `onShotDone` reads it.
    if (landed.outcome === 'faceplant' || landed.outcome === 'hole') {
      expect(landed.hamster.y).toBe(C.GROUND_Y);
    } else {
      expect(landed.hamster.y).toBeGreaterThan(C.SKID_Y);
      expect(landed.hamster.y).toBeLessThanOrEqual(C.GROUND_Y);
    }
  });

  it('holds that position for the whole settle, including the pan home', () => {
    const sim = connectingShot(0x5eed_0003);
    const at = sim.snapshot().hamster;
    while (sim.phaseKind === 'settling') {
      const now = sim.snapshot().hamster;
      expect(now.x).toBe(at.x);
      expect(now.y).toBe(at.y);
      sim.step();
    }
    // `onDone()` is what puts the hamster back on the pad, and only once the
    // camera has arrived. Game.as:971-981.
    expect(sim.phaseKind).toBe('ready');
    expect(sim.snapshot().hamster.x).toBe(C.HAMSTER_X);
    expect(sim.snapshot().hamster.y).toBe(C.HAMSTER_START_Y);
  });

  it('reports the shot standing still, so the pose cannot rotate', () => {
    const sim = connectingShot(0x5eed_0003);
    const h = sim.snapshot().hamster;
    expect(h.xvel).toBe(0);
    expect(h.yvel).toBe(0);
    expect(h.doRotation).toBe(false);
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

  it('arrives in a single pan step when the camera is already home', () => {
    // This used to be reached through a zero shot. Only a launched shot enters
    // `settling` now, and a launch always moves the camera, so the property is
    // pinned on the pan itself.
    const camera = newCamera();
    expect(quickPanStep(camera, C.CAM_RESET_TARGET_X, C.CAM_RESET_TARGET_Y, C.CAM_QPAN_TIME)).toBe(
      true,
    );
    expect(camera).toEqual(newCamera());
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
      all.push(...playTurn(sim));
      all.push(...stepOut(sim, 'settling'));
    }
    expect(sim.phaseKind).toBe('gameOver');
    const over = all.find(e => e.t === 'gameOver');
    expect(over?.t).toBe('gameOver');
    if (over?.t !== 'gameOver') return;
    expect(over.shots).toHaveLength(C.TURNS);
    expect(over.total).toBe(over.shots.reduce((sum, feet) => sum + feet, 0));
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
