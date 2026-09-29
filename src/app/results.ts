import type { ResultsModel, ResultsView } from "@/app/MetaGame.ts";

export interface ResultsActions {
  readonly again: () => void;
  readonly switchMode: () => void;
  readonly share: () => void;
}

function text(el: HTMLElement | null, value: string): void {
  if (el !== null) el.textContent = value;
}

/** An empty list is no list: hidden, so it leaves no gap in the card. */
function list(el: HTMLElement | null, items: readonly HTMLElement[]): void {
  el?.replaceChildren(...items);
  if (el !== null) el.hidden = items.length === 0;
}

/**
 * The results panel over the stage once PLAY AGAIN is up. A card in the
 * middle, not a sheet over everything: a click on the stage around it still
 * plays again, as it always did, and so do Space and Enter on its first button.
 */
export function resultsView(root: HTMLElement | null, actions: ResultsActions): ResultsView {
  const q = <T extends HTMLElement>(sel: string): T | null => root?.querySelector<T>(sel) ?? null;
  const title = q("#results-title");
  const badge = q("#results-badge");
  const shots = q("#results-shots");
  const total = q("#results-total");
  const notes = q("#results-notes");
  const unlocked = q("#results-unlocked");
  const again = q<HTMLButtonElement>("#results-again");
  const toggle = q<HTMLButtonElement>("#results-mode");
  const share = q<HTMLButtonElement>("#results-share");
  again?.addEventListener("click", actions.again);
  toggle?.addEventListener("click", actions.switchMode);
  share?.addEventListener("click", actions.share);

  return {
    show(m: ResultsModel): void {
      if (root === null) return;
      text(title, m.title);
      text(badge, m.badge ?? "");
      if (badge !== null) badge.hidden = m.badge === null;
      list(
        shots,
        m.shots.map((shot) => {
          const li = document.createElement("li");
          const name = document.createElement("span");
          name.textContent = shot.label;
          const value = document.createElement("span");
          value.textContent = shot.value;
          li.append(name, value);
          if (shot.best) li.className = "best";
          return li;
        }),
      );
      text(total, m.total);
      list(
        notes,
        m.notes.map((note) => {
          const p = document.createElement("p");
          p.textContent = note;
          return p;
        }),
      );
      list(
        unlocked,
        m.unlocked.map((name) => {
          const li = document.createElement("li");
          li.textContent = name;
          return li;
        }),
      );
      // A link left over from the last game's share is not this game's.
      const link = q<HTMLInputElement>("#results-link");
      if (link !== null) link.hidden = true;
      text(again, m.again);
      text(toggle, m.switchLabel);
      text(share, m.share);
      root.hidden = false;
      // Space and Enter now press PLAY AGAIN, as they did on the stage.
      again?.focus({ preventScroll: true });
    },
    hide(): void {
      if (root === null || root.hidden) return;
      const hadFocus = root.contains(document.activeElement);
      root.hidden = true;
      if (hadFocus) document.querySelector<HTMLElement>("#stage")?.focus({ preventScroll: true });
    },
  };
}
