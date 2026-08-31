import type { InputCommand } from '@/sim/commands.ts';

/**
 * Turns DOM events into a queue of discrete commands drained once per tick.
 *
 * Discrete, not sampled: the glide lift is frozen at the xvel measured when the
 * button went down, so "pressed this tick" and "still holding" are genuinely
 * different inputs and a boolean cannot carry that.
 */
export class InputController {
  #queue: InputCommand[] = [];
  #pointerDown = false;
  #detach: Array<() => void> = [];

  attach(target: HTMLElement): void {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (ev: HTMLElementEventMap[K]) => void,
    ): void => {
      target.addEventListener(type, handler as EventListener);
      this.#detach.push(() => target.removeEventListener(type, handler as EventListener));
    };

    on('pointerdown', ev => {
      ev.preventDefault();
      target.focus();
      if (this.#pointerDown) return;
      this.#pointerDown = true;
      this.#queue.push({ kind: 'press' }, { kind: 'confirm' });
    });

    const up = (): void => {
      if (!this.#pointerDown) return;
      this.#pointerDown = false;
      this.#queue.push({ kind: 'release' });
    };
    on('pointerup', up);
    on('pointercancel', up);
    on('pointerleave', up);

    on('keydown', ev => {
      if (ev.repeat) return;
      if (ev.key === ' ' || ev.key === 'Enter') {
        ev.preventDefault();
        if (this.#pointerDown) return;
        this.#pointerDown = true;
        this.#queue.push({ kind: 'press' }, { kind: 'confirm' });
      } else if (ev.key === 'p' || ev.key === 'P') {
        this.#queue.push({ kind: 'togglePause' });
      }
    });

    on('keyup', ev => {
      if (ev.key === ' ' || ev.key === 'Enter') up();
    });
  }

  detach(): void {
    for (const off of this.#detach) off();
    this.#detach = [];
  }

  /** Hand the queued commands to the simulation and clear it. */
  drain(): readonly InputCommand[] {
    if (this.#queue.length === 0) return [];
    const out = this.#queue;
    this.#queue = [];
    return out;
  }
}
