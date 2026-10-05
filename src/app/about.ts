import { ACHIEVEMENT_IDS, type Strings } from "@/app/i18n.ts";
import { achievementCount } from "@/app/MetaGame.ts";
import type { Progress } from "@/app/progress.ts";

export interface AboutHooks {
  /** Called as the panel opens; set by boot once there is a game to pause. */
  onOpen: () => void;
  toggle: () => void;
}

/**
 * The help and credits, over the stage from the corner button or `I`. Wired
 * before anything loads, so they open even on a page whose game failed to
 * start. `onOpen` lets the game pause itself once it exists.
 *
 * A dialog: focus moves in and comes back to the stage, Tab stays inside, and
 * Esc closes it - caught before the game's own Esc, which would pause. That
 * depends on this being wired before the input controller, which is why boot
 * does it first.
 */
export function wireAbout(canvas: HTMLCanvasElement, signal: AbortSignal): AboutHooks {
  const hooks: AboutHooks = { onOpen: (): void => {}, toggle: (): void => {} };
  const button = document.querySelector<HTMLButtonElement>("#info");
  const about = document.querySelector<HTMLElement>("#about");
  const card = about?.querySelector<HTMLElement>(":scope > div");
  if (button === null || about === null || card === null || card === undefined) return hooks;
  const show = (open: boolean): void => {
    about.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      hooks.onOpen();
      card.focus({ preventScroll: true });
    } else {
      canvas.focus({ preventScroll: true });
    }
  };
  hooks.toggle = () => show(about.hasAttribute("hidden"));
  button.addEventListener("click", hooks.toggle, { signal });
  about.querySelector("#about-close")?.addEventListener("click", () => show(false), { signal });
  // Anywhere on the overlay closes it - except the settings and the
  // achievements, which are there to be used.
  about.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest("section") !== null) return;
      show(false);
    },
    { signal },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (about.hasAttribute("hidden")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        show(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...card.querySelectorAll<HTMLElement>("button, input, select, [tabindex='0']"),
      ].filter((el) => el.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      const inside = card.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    },
    { signal, capture: true },
  );
  return hooks;
}

/** The help panel's list of achievements, the earned ones marked, and its count. */
export function renderAchievements(t: Strings, p: Progress): void {
  const list = document.querySelector<HTMLElement>("#achievements");
  const heading = document.querySelector<HTMLElement>("#achievements-count");
  if (list === null) return;
  list.replaceChildren(
    ...ACHIEVEMENT_IDS.map((id) => {
      const [title, detail] = t.achievements[id];
      const li = document.createElement("li");
      li.textContent = title;
      const small = document.createElement("small");
      small.textContent = detail;
      li.append(small);
      if (id in p.achievements) li.className = "done";
      return li;
    }),
  );
  const { done, of } = achievementCount(p);
  if (heading !== null) heading.textContent = `(${t.achievementsDone(done, of)})`;
}
