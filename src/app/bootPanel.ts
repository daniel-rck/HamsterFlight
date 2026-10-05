/**
 * The boot panel stays in the document, hidden, so a failure after boot has
 * somewhere to report itself. Removing it used to leave late errors invisible.
 */
export function setBootMessage(text: string, fraction: number | null = null): void {
  const boot = document.querySelector<HTMLElement>("#boot");
  if (boot === null) return;
  const line = boot.querySelector<HTMLElement>("#boot-text");
  if (line !== null) line.textContent = text;
  const bar = boot.querySelector<HTMLElement>(".boot-bar");
  if (bar !== null) {
    bar.toggleAttribute("data-known", fraction !== null);
    if (fraction !== null) bar.style.setProperty("--p", String(fraction));
  }
  boot.hidden = false;
}

/** The game is up: the panel goes out of sight, not out of the document. */
export function hideBootPanel(): void {
  const boot = document.querySelector<HTMLElement>("#boot");
  if (boot !== null) boot.hidden = true;
}

/**
 * A failure the player can do something about: say what happened in words
 * they can act on, and give them the one control that helps. "See the
 * console" was the whole message before, which meant nothing to a player.
 */
export function showFailure(text: string, reloadLabel: string): void {
  const boot = document.querySelector<HTMLElement>("#boot");
  if (boot === null) return;
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = text;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = reloadLabel;
  reload.addEventListener("click", () => window.location.reload());
  const logo = boot.querySelector(".boot-logo");
  boot.replaceChildren(...(logo === null ? [] : [logo]), message, reload);
  boot.hidden = false;
  reload.focus();
}
