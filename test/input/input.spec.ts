import { describe, expect, it } from "vitest";
import { InputController, type InputTargets } from "@/input/InputController.ts";

/** Node has EventTarget and Event; the DOM subclasses are faked by assignment. */
function fakeCanvas(): HTMLElement & { focused: number } {
  const target = new EventTarget() as EventTarget & { focused: number; focus: () => void };
  target.focused = 0;
  target.focus = () => {
    target.focused++;
  };
  return target as unknown as HTMLElement & { focused: number };
}

function fakePage(): InputTargets["page"] & { hide(): void } {
  const target = new EventTarget() as EventTarget & { hidden: boolean; hide(): void };
  target.hidden = false;
  target.hide = () => {
    target.hidden = true;
    target.dispatchEvent(new Event("visibilitychange"));
  };
  return target;
}

function key(target: EventTarget, type: "keydown" | "keyup", key: string, extra = {}): Event {
  const ev = Object.assign(new Event(type, { cancelable: true }), {
    key,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  });
  target.dispatchEvent(ev);
  return ev;
}

function pointer(target: EventTarget, type: string, pointerId: number): void {
  target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId }));
}

function setup() {
  const canvas = fakeCanvas();
  const keys = new EventTarget();
  const page = fakePage();
  const input = new InputController();
  const toggles: number[] = [];
  input.attach(canvas, {
    targets: { keys, page },
    onToggleHitboxes: () => toggles.push(1),
  });
  return { canvas, keys, page, input, toggles };
}

const kinds = (input: InputController) => input.drain().map((c) => c.kind);

describe("InputController", () => {
  it("turns a pointer press and release into press, confirm, release", () => {
    const { canvas, input } = setup();
    pointer(canvas, "pointerdown", 1);
    pointer(canvas, "pointerup", 1);
    expect(kinds(input)).toEqual(["press", "confirm", "release"]);
    expect(canvas.focused).toBe(1);
    expect(kinds(input)).toEqual([]);
  });

  it("ignores a second finger, including its lift", () => {
    const { canvas, input } = setup();
    pointer(canvas, "pointerdown", 1);
    pointer(canvas, "pointerdown", 2);
    pointer(canvas, "pointerup", 2);
    expect(kinds(input)).toEqual(["press", "confirm"]);
    expect(input.held).toBe(true);
    pointer(canvas, "pointerup", 1);
    expect(kinds(input)).toEqual(["release"]);
  });

  it("treats Space and Enter as the button and swallows the page scroll", () => {
    const { keys, input } = setup();
    const down = key(keys, "keydown", " ");
    expect(down.defaultPrevented).toBe(true);
    key(keys, "keydown", " ", { repeat: true });
    key(keys, "keyup", " ");
    expect(kinds(input)).toEqual(["press", "confirm", "release"]);
    key(keys, "keydown", "Enter");
    key(keys, "keyup", "Enter");
    expect(kinds(input)).toEqual(["press", "confirm", "release"]);
  });

  it("leaves shortcuts with modifiers to the browser", () => {
    const { keys, input, toggles } = setup();
    key(keys, "keydown", "p", { ctrlKey: true });
    key(keys, "keydown", "P", { metaKey: true });
    key(keys, "keydown", "h", { altKey: true });
    expect(kinds(input)).toEqual([]);
    expect(toggles).toHaveLength(0);
    key(keys, "keydown", "p");
    key(keys, "keydown", "H");
    expect(kinds(input)).toEqual(["togglePause"]);
    expect(toggles).toHaveLength(1);
  });

  it("does not steal keys from a text field", () => {
    const { keys, input } = setup();
    const field = { tagName: "INPUT" };
    const ev = Object.assign(new Event("keydown", { cancelable: true }), {
      key: " ",
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    });
    Object.defineProperty(ev, "target", { value: field });
    keys.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(kinds(input)).toEqual([]);
  });

  it("releases a held key when the window loses focus", () => {
    const { keys, input } = setup();
    key(keys, "keydown", " ");
    expect(kinds(input)).toEqual(["press", "confirm"]);
    keys.dispatchEvent(new Event("blur"));
    expect(kinds(input)).toEqual(["release"]);
    // The keyup that arrives later, if it does, is not a second release.
    key(keys, "keyup", " ");
    expect(kinds(input)).toEqual([]);
  });

  it("releases a held pointer when the tab is hidden", () => {
    const { canvas, page, input } = setup();
    pointer(canvas, "pointerdown", 4);
    input.drain();
    page.hide();
    expect(kinds(input)).toEqual(["release"]);
    expect(input.held).toBe(false);
  });

  it("does not let the key and the pointer double-press", () => {
    const { canvas, keys, input } = setup();
    key(keys, "keydown", " ");
    pointer(canvas, "pointerdown", 1);
    expect(kinds(input)).toEqual(["press", "confirm"]);
    key(keys, "keyup", " ");
    expect(kinds(input)).toEqual(["release"]);
  });

  it("detaches cleanly", () => {
    const { canvas, keys, input } = setup();
    input.detach();
    pointer(canvas, "pointerdown", 1);
    key(keys, "keydown", " ");
    expect(kinds(input)).toEqual([]);
  });
});
