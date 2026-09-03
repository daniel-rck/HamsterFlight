/**
 * Which build is running, stamped in by `vite.config.ts` at build time.
 *
 * Worth showing because this port ships continuously and its behaviour is
 * tuned against a reference: "the hamster does X" is only answerable against a
 * known commit. A trailing `+` on the hash means the tree was dirty when it was
 * built, so the hash alone does not describe it.
 */
declare const __BUILD__: { readonly commit: string; readonly date: string } | undefined;

/**
 * `define` substitutes this at build time, so outside a Vite build - a unit
 * test, a REPL - the identifier simply is not there. `typeof` on an undeclared
 * name is the one safe way to ask, and the answer is the same "no hash to
 * read" case the label already handles.
 */
export const BUILD =
  typeof __BUILD__ === "undefined"
    ? { commit: "unknown", date: new Date().toISOString().slice(0, 10) }
    : __BUILD__;

/** e.g. `2c1e3d4c · 2026-09-01`, or `dev` when nothing could be determined. */
export function versionLabel(build: typeof BUILD = BUILD): string {
  if (build.commit === "unknown") return `dev · ${build.date}`;
  return `${build.commit} · ${build.date}`;
}
