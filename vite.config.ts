import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * What is running, stamped in at build time.
 *
 * Git first, because it is the only source that gives the hash and the date of
 * the *same* commit; the CI variables carry a hash but no date, and the wall
 * clock at build time answers a different question. They are the fallback for
 * a build from a tarball or a checkout with no git available, and `unknown` is
 * the last resort - deliberately something a reader can tell apart from a real
 * build rather than a plausible-looking lie.
 *
 * `GITHUB_SHA` is Actions; `WORKERS_CI_COMMIT_SHA` and `CF_PAGES_COMMIT_SHA`
 * are Cloudflare Workers Builds and Pages.
 */
function buildStamp(): { commit: string; date: string } {
  const git = (...args: string[]): string | null => {
    try {
      return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };

  const commit = git("rev-parse", "--short=8", "HEAD");
  const date = git("log", "-1", "--format=%cs");
  if (commit !== null && date !== null) {
    // A dirty tree is a build nobody can reproduce from the hash, so say so.
    const dirty = git("status", "--porcelain") !== "";
    return { commit: dirty ? `${commit}+` : commit, date };
  }

  const env =
    process.env.GITHUB_SHA ??
    process.env.WORKERS_CI_COMMIT_SHA ??
    process.env.CF_PAGES_COMMIT_SHA ??
    null;
  return {
    commit: env === null ? "unknown" : env.slice(0, 8),
    date: new Date().toISOString().slice(0, 10),
  };
}

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(buildStamp()),
  },
  // Absolute asset URLs: the site is deployed at the root, and public/_headers
  // matches on /assets/*. Relative URLs would break that under any subpath.
  base: "/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    // Maps are emitted for debugging a deployed build against its commit, but
    // not referenced from the bundle: a visitor's devtools do not reconstruct
    // src/ on their own. Open one by hand when a stack trace needs it.
    sourcemap: "hidden",
    // Never inline assets. Most sprite frames are 2-5 kB, which is under the
    // 4 kB default, so they would be base64'd into the JS bundle - hundreds of
    // them. As separate files they are content-hashed and cached immutably,
    // and the entry chunk stays small enough to parse instantly.
    assetsInlineLimit: 0,
    // A warning only; the gate that fails is `npm run check:bundle`, whose
    // budgets live in scripts/bundle-report.ts. This number is echoed there.
    chunkSizeWarningLimit: 400,
  },
  server: {
    port: 5173,
    open: false,
  },
});
