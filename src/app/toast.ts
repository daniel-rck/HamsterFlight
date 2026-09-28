/**
 * One line of news at the top of the stage - an achievement, a record, a
 * copied link - shown for a few seconds and queued behind the one before it.
 * The element is a polite live region, so a screen reader hears it too.
 */
export class Toasts {
  readonly #el: HTMLElement | null;
  readonly #queue: string[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;

  static readonly SHOW_MS = 3200;

  constructor(el: HTMLElement | null) {
    this.#el = el;
  }

  show(text: string): void {
    if (this.#el === null) return;
    // The same news twice in a row is once.
    if (this.#queue.at(-1) === text || (this.#timer !== null && this.#el.textContent === text)) {
      return;
    }
    this.#queue.push(text);
    if (this.#timer === null) this.#next();
  }

  #next(): void {
    const el = this.#el;
    const text = this.#queue.shift();
    if (el === null || text === undefined) {
      if (el !== null) el.hidden = true;
      this.#timer = null;
      return;
    }
    el.textContent = text;
    el.hidden = false;
    this.#timer = setTimeout(() => this.#next(), Toasts.SHOW_MS);
  }
}
