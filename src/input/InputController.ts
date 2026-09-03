import type { InputCommand } from "@/sim/commands.ts";

/** Where the keyboard and the page-visibility events come from; injectable for tests. */
export interface InputTargets {
  readonly keys: EventTarget;
  readonly page: EventTarget & { readonly hidden: boolean };
}

export interface InputOptions {
  /** `H` - a renderer concern, not a simulation command, so it is a callback. */
  readonly onToggleHitboxes?: () => void;
  readonly targets?: InputTargets;
}

/**
 * Turns DOM events into a queue of discrete commands drained once per tick.
 *
 * Discrete, not sampled: the glide lift is frozen at the xvel measured when the
 * button went down, so "pressed this tick" and "still holding" are genuinely
 * different inputs and a boolean cannot carry that.
 *
 * Pointer events are bound to the canvas; the keyboard to the window, so the
 * page is playable without first clicking the stage. Whatever is holding the
 * button, losing the window - Alt-Tab, a second touch, a print dialog -
 * releases it, or the glide would stick until the hamster landed.
 */
export class InputController {
  #queue: InputCommand[] = [];
  /** The pointer that owns the current press, or null when nothing is held. */
  #pointerId: number | null = null;
  #keyDown = false;
  #detach: Array<() => void> = [];

  attach(canvas: HTMLElement, options: InputOptions = {}): void {
    const targets = options.targets ?? { keys: window, page: document };
    const on = <E extends Event>(
      target: EventTarget,
      type: string,
      handler: (ev: E) => void,
    ): void => {
      const listener = handler as EventListener;
      target.addEventListener(type, listener);
      this.#detach.push(() => target.removeEventListener(type, listener));
    };

    on<PointerEvent>(canvas, "pointerdown", (ev) => {
      ev.preventDefault();
      canvas.focus({ preventScroll: true });
      // A second finger neither presses again nor, when lifted, releases the first.
      if (this.#pointerId !== null || this.#keyDown) return;
      this.#pointerId = ev.pointerId;
      this.#press();
    });
    const pointerUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== this.#pointerId) return;
      this.#pointerId = null;
      this.#release();
    };
    on<PointerEvent>(canvas, "pointerup", pointerUp);
    on<PointerEvent>(canvas, "pointercancel", pointerUp);
    on<PointerEvent>(canvas, "pointerleave", pointerUp);

    on<KeyboardEvent>(targets.keys, "keydown", (ev) => {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (isTyping(ev.target)) return;
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        if (this.#keyDown || this.#pointerId !== null) return;
        this.#keyDown = true;
        this.#press();
      } else if (ev.key === "p" || ev.key === "P") {
        this.#queue.push({ kind: "togglePause" });
      } else if (ev.key === "h" || ev.key === "H") {
        options.onToggleHitboxes?.();
      }
    });
    on<KeyboardEvent>(targets.keys, "keyup", (ev) => {
      if (ev.key !== " " && ev.key !== "Enter") return;
      if (!this.#keyDown) return;
      this.#keyDown = false;
      this.#release();
    });

    // The keyup goes to whoever has focus now, so treat losing it as one.
    on(targets.keys, "blur", () => this.releaseAll());
    on(targets.page, "visibilitychange", () => {
      if (targets.page.hidden) this.releaseAll();
    });
  }

  detach(): void {
    for (const off of this.#detach) off();
    this.#detach = [];
  }

  /** Whether a press is currently held, by pointer or key. */
  get held(): boolean {
    return this.#pointerId !== null || this.#keyDown;
  }

  /** Let go of whatever is held - the window went away, so the keyup will not arrive. */
  releaseAll(): void {
    if (!this.held) return;
    this.#pointerId = null;
    this.#keyDown = false;
    this.#release();
  }

  #press(): void {
    this.#queue.push({ kind: "press" }, { kind: "confirm" });
  }

  #release(): void {
    this.#queue.push({ kind: "release" });
  }

  /** Hand the queued commands to the simulation and clear it. */
  drain(): readonly InputCommand[] {
    if (this.#queue.length === 0) return [];
    const out = this.#queue;
    this.#queue = [];
    return out;
  }
}

/** Space in a text field is a space, not a jump. */
function isTyping(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object" || !("tagName" in target)) return false;
  const el = target as { tagName: string; isContentEditable?: boolean };
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}
