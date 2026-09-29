/**
 * What the platform offers for passing a link on - injectable, so the order of
 * attempts can be tested without a browser.
 */
export interface ShareEnv {
  readonly share?: ((data: ShareData) => Promise<void>) | undefined;
  readonly writeText?: ((text: string) => Promise<void>) | undefined;
}

/**
 * - `shared`: the system share sheet took it
 * - `copied`: it is on the clipboard
 * - `cancelled`: the player closed the share sheet - nothing more to do
 * - `manual`: neither worked, so the page has to show the link to copy by hand
 */
export type ShareOutcome = "shared" | "copied" | "cancelled" | "manual";

/**
 * The share sheet where there is one, the clipboard where there is not - or
 * where the sheet refused for any reason but the player's own cancel (a
 * desktop browser without a share target throws NotAllowedError) - and
 * finally the link itself. The last step used to be `window.prompt`, a
 * blocking dialog in the middle of a game page.
 */
export async function shareLink(env: ShareEnv, url: string, text: string): Promise<ShareOutcome> {
  if (env.share !== undefined) {
    try {
      await env.share({ title: "HamsterFlight", text, url });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  if (env.writeText !== undefined) {
    try {
      await env.writeText(url);
      return "copied";
    } catch {
      // Denied, or no focus: fall through to showing it.
    }
  }
  return "manual";
}

/** The browser's own share and clipboard, bound so they can be called bare. */
export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    share: typeof nav?.share === "function" ? (data) => nav.share(data) : undefined,
    writeText:
      typeof nav?.clipboard?.writeText === "function"
        ? (text) => nav.clipboard.writeText(text)
        : undefined,
  };
}
