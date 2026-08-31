import { SPRITES, type SpriteId } from '@/assets/sprites.generated.ts';
import type { FxId, SimEvent } from '@/sim/events.ts';

/** The three impact clips the original played and this port never drew. */
const FX_SPRITE: Record<FxId, SpriteId> = {
  bounceFx: 'fx/bounce',
  break: 'fx/break',
  superBreak: 'fx/superBreak',
};

/** Impact clips animate on the original stage rate, like every other sprite. */
const FX_FPS = 19;

export interface ActiveFx {
  readonly sprite: SpriteId;
  readonly frame: number;
  /** World coordinates, as the simulation reported them. */
  readonly x: number;
  readonly y: number;
}

interface LiveFx {
  readonly sprite: SpriteId;
  readonly x: number;
  readonly y: number;
  readonly frames: number;
  readonly startedMs: number;
}

/**
 * Decoration driven by the simulation's event stream.
 *
 * `sim.step()` has always returned `SimEvent[]`, and `main.ts` has always
 * thrown it away - so `fx/bounce`, `fx/break` and `fx/superBreak` sat in the
 * manifest, extracted from the SWF, never once drawn. This reads that stream
 * and keeps the short-lived clips it asks for.
 *
 * Effects are decoration: they hold no simulation state and nothing in the
 * physics path reads them, exactly as `porting-notes.md` requires of clouds and
 * bushes. Time enters through the caller so this module stays testable.
 */
export class Effects {
  #live: LiveFx[] = [];

  /** Takes one tick's events. Anything that is not an `fx` cue is ignored. */
  consume(events: readonly SimEvent[], nowMs: number): void {
    for (const event of events) {
      if (event.t !== 'fx') continue;
      const sprite = FX_SPRITE[event.id];
      this.#live.push({
        sprite,
        x: event.x,
        y: event.y,
        frames: SPRITES[sprite].frames,
        startedMs: nowMs,
      });
    }
  }

  /** What to draw this frame. Clips that have run out are dropped here. */
  active(nowMs: number): readonly ActiveFx[] {
    const out: ActiveFx[] = [];
    let keep = 0;
    for (const fx of this.#live) {
      const frame = Math.floor(((nowMs - fx.startedMs) / 1000) * FX_FPS);
      if (frame < 0 || frame >= fx.frames) continue;
      this.#live[keep++] = fx;
      out.push({ sprite: fx.sprite, frame, x: fx.x, y: fx.y });
    }
    this.#live.length = keep;
    return out;
  }

  /** Drop everything in flight - on a restart, or when the tab comes back. */
  clear(): void {
    this.#live.length = 0;
  }
}
