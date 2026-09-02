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
├── render/       # pixi renderers + HUD; reads sim state, never writes it
├── app/          # boot, loop, input, frame profiler
└── persistence/  # localStorage highscores
reference/        # vendored: decompiled bytecode, extraction tools, notes
```

### The sim is pure, and that is enforced

`src/sim/**` must stay headless and deterministic. Two independent guards keep
it that way, and both are part of `bun run verify`:

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
| CI keeps `guards`, `actionlint`, `smoke`, `dependency-review`, `gate`/`deploy` | Real gates this repo needs: a runtime-only audit, the purity and atlas checks, a bundle budget, and the only check that actually opens the page. |
| `noUnusedVariables` / `noUnusedImports` / `noExplicitAny` at `error` | The shared base keeps them at `warn`; this repo has earned the stricter setting. |

### The `gate` job must survive verbatim

`secrets` cannot be referenced from a job-level `if`, so `gate` converts
`CLOUDFLARE_API_TOKEN` into a job output that `deploy` tests. It is the switch
that prevents double-deploying alongside the Cloudflare dashboard integration.

## Quality gates

```bash
bun run verify   # lint, sim purity, atlas, typecheck, tests, build, bundle budget
bun run smoke    # opens the built page in Chromium — shader link, asset 404s
```
