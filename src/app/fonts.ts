import latinExtUrl from "@fontsource-variable/fredoka/files/fredoka-latin-ext-wght-normal.woff2?url";
import latinUrl from "@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2?url";

/**
 * The port's one typeface: Fredoka (SIL OFL 1.1), a variable 300-700 weight,
 * served from this origin. Registered through the FontFace API rather than a
 * stylesheet so boot can wait on it - the HUD is canvas text, and a canvas
 * that draws before the face arrives keeps the fallback until the next
 * string change.
 *
 * Only the two Latin subsets: `unicode-range` means the browser fetches the
 * 30 kB Latin file for any page and the 5 kB extension only for a name that
 * needs it. Hebrew, which the package also ships, is never referenced.
 */

export const FONT_FAMILY = "Fredoka";

const FACES = [
  {
    url: latinUrl,
    range:
      "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  },
  {
    url: latinExtUrl,
    range:
      "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  },
] as const;

/**
 * Registers the faces and resolves once the Latin one is usable, or after
 * `timeoutMs` - whichever is first - to whether it made it. Never rejects: a
 * blocked or slow font is the fallback stack, not a failed boot.
 */
export function loadFonts(timeoutMs = 1500): Promise<boolean> {
  if (typeof FontFace !== "function" || typeof document === "undefined" || !document.fonts) {
    return Promise.resolve(false);
  }
  const [latin, ...rest] = FACES.map(
    ({ url, range }) =>
      new FontFace(FONT_FAMILY, `url(${url}) format("woff2")`, {
        weight: "300 700",
        display: "swap",
        unicodeRange: range,
      }),
  );
  if (latin === undefined) return Promise.resolve(false);
  for (const face of [latin, ...rest]) document.fonts.add(face);
  const loaded = latin.load().then(
    () => true,
    () => false,
  );
  const late = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([loaded, late]);
}

/** Resolves when the Latin face has loaded, however late. */
export function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  return document.fonts.load(`600 16px "${FONT_FAMILY}"`).then(
    () => undefined,
    () => undefined,
  );
}
