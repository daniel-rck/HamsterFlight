# 00 — HamsterFlight

A faithful browser port of the Flash game *Flight of the Hamsters*,
reconstructed from bytecode analysis of the original SWF.

## What this app is, and is not

It is a **pixi.js canvas game**. It has one runtime dependency (`pixi.js`), no
React, no Tailwind, no router, no IndexedDB layer, no service worker, and its
Worker serves static assets only. It shares the web-base *tooling* baseline —
Bun, Biome, the reusable CI job, the hygiene files — and nothing else.

That is a decision, not drift. `web-base check` reports `layout`, `storage`,
`router` and `pwa` as *not adopted* for this repo, which is the intended answer;
`check --strict` must never be used here.

## Architecture

```
src/
├── sim/          # pure, deterministic simulation — no DOM, no time, no I/O
├── render/       # the two backends plus scene/ and the HUD; read snapshots, never write
├── input/        # DOM events to discrete press/release/confirm/pause commands
├── assets/       # the atlas sheets and the generated placement manifest
├── app/          # boot (main.ts), the fixed-timestep loop, URL params, frame profiler
reference/        # vendored: decompiled bytecode, extraction tools, notes
```

There is no persistence layer: the game keeps no scores between visits, and
the simulation may not touch storage even if one is added later.

### The sim is pure, and that is enforced

`src/sim/**` must stay headless and deterministic. Three independent guards
keep it that way, and all of them are part of `bun run verify`:

- **`scripts/check-sim-purity.ts`** — a static check over the module graph.
- **A lint rule** — `biome.json` scopes a `noRestrictedGlobals` deny-list to
  `src/sim/**` covering `window`, `document`, `navigator`, `performance`,
  `localStorage`, `requestAnimationFrame` and `fetch`. Each entry carries the
  reason. `performance` is denied because **time must not enter the sim**: it
  steps in fixed 50 ms ticks, which is what makes replays and the golden tests
  reproducible.
- **`tsconfig.sim.json`** compiles the sim with `lib: ["ES2022"]` and
  `types: []`, so DOM types are not even in scope.

### Physics numbers are evidence, not taste

Most constants in `src/sim/constants.ts` were read out of the original
bytecode. Do not tune them. A value that is a genuine judgement call belongs in
`tuning.ts`, and a change to `constants.ts` needs a bytecode reference in the
PR. See `reference/doc/porting-notes.md`.

## Deviations from web-base, and why

| Deviation | Reason |
|---|---|
| No React / router / storage / layout / PWA | It is a canvas game. |
| `wrangler.jsonc`, not `wrangler.toml` | Functionally equivalent; the repo predates the convention. |
| `not_found_handling: "404-page"` | Correct for a single-page game — the SPA fallback would mask real 404s. |
| English README | It is a technical port write-up whose audience is the emulation community, not an end-user app README. |
| CI adds `checks` and `smoke` next to the shared `ci` job | Real gates this repo needs: the purity and atlas checks, a bundle budget, and the only check that actually opens the page (and serves it through `wrangler dev` for the header and 404 semantics). |
| `noUnusedVariables` / `noUnusedImports` / `noExplicitAny` at `error` | The shared base keeps them at `warn`; this repo has earned the stricter setting. |

### CI does not deploy

The old `gate`/`deploy` pair - which turned `CLOUDFLARE_API_TOKEN` into a job
output because `secrets` cannot be read from a job-level `if` - went with #8.
Cloudflare Workers Builds deploys every push to `main` through the Git
integration, so there is no second deploy path to guard against; see
`SETUP.md`. The workflow gates pull requests and nothing else.

One more thing the workflow file has to get right: `web-base-check.yml` takes
`template`, `ref` and `strict` and no other input. Passing it anything else
(`bun-version`, say) is a `startup_failure` for the whole run - no jobs, no
check runs, a PR that looks clean. After any change to `ci.yml`, confirm the
runs actually start.

## Quality gates

```bash
bun run verify   # lint, sim purity, atlas, typecheck, tests, build, bundle budget
bun run smoke    # opens the built page in Chromium — shader link, asset 404s
```
