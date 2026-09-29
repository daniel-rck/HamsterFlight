# 00 — HamsterFlight

A faithful browser port of the Flash game *Flight of the Hamsters*,
reconstructed from bytecode analysis of the original SWF.

## What this app is, and is not

It is a **pixi.js canvas game**. It has one runtime dependency (`pixi.js`), no
React, no Tailwind, no router, no IndexedDB layer, no service worker, and its
Worker serves static assets only. It shares the web-base *tooling* baseline —
Bun, oxlint + oxfmt, the reusable CI job, the hygiene files — and nothing else.

That is a decision, not drift. `web-base check` reports `layout`, `storage`,
`router` and `pwa` as *not adopted* for this repo, which is the intended answer;
`check --strict` must never be used here.

## Architecture

```
src/
├── sim/          # pure, deterministic simulation — no DOM, no time, no I/O
├── render/       # the two backends plus scene/ and the HUD; read snapshots, never write
├── input/        # DOM events to discrete press/release/confirm/pause commands
├── assets/       # atlas sheets, sounds, generated manifests
├── audio/        # the Web Audio player - reads the sim's sound cues, never writes
├── app/          # boot (main.ts), the loop, URL params, and the game around the game:
│                 #   recording/replay, session, records, daily, ghost, achievements,
│                 #   i18n, the opening screen, the typeface
reference/        # vendored: decompiled bytecode and frame scripts, extraction tools, notes
```

Everything under `src/assets/` except the loaders is generated from the
original SWF by `reference/tools/` (sprites and sounds),
and `reference/as2/` holds both the decompiled classes and the timeline frame
scripts. The frame scripts matter as much as the classes: the jump, the
outcome clips, a third of the sounds and the start of the game are all driven
from clip frames, not from `Game.as`.

### Sound

The simulation emits sound cues as events (`sfx`, `sfxStop`, `sfxGain`), with
timeline sounds scheduled in stage frames (`delayFrames`). `src/audio/`
plays them with Flash `Sound` semantics through Web Audio, fetched with
`fetch` (the CSP's `connect-src 'self'`), from its own lazy chunk. It starts on
the first user gesture, suspends with the game's pause, and never feeds back
into the simulation. The music button mutes music only, as the original's did.

### Start of the game

A visit opens on the port's own opening screen over a still of the scene,
where the original showed its INSTRUCTIONS board (frame 6): the name, how to
play for the device in hand (mouse and keys, touch, or a pad), what each item
does, sound and language, and two ways in - the mode the link opened (free
play, today's challenge, a duel) and the other one. Its first button starts
the loop and unlocks audio. It is HTML in the port's typeface with the
original's sprites cut from the atlas, in a lazy chunk fetched alongside it.
`?profile` and `?instructions=0` skip it. There is no title screen.

### Look

One typeface, Fredoka (SIL OFL, self-hosted, `font-src 'self'`), and one set
of colour tokens (`:root` in `index.html`, `HUD_COLOURS` in
`src/render/scene/hud.ts`) for everything the port draws over the original's
picture: the HUD cards, the opening screen, the results, the help, the toasts.
The HUD's geometry and type sizes live in `scene/hud.ts`, so both backends
draw the same cards. The distance signs are world art and keep their stand-in
for the original's font.

### Around the game

The port adds a layer the original did not have - records, a results panel,
a daily challenge, a ghost to race, achievements, a German translation - and
all of it lives in `src/app/`, reading the simulation's snapshots and events
and never writing to it. The only way it changes a game is by choosing the
seed of the next one.

- **Every game is recorded** (`recording.ts`): the seed and the commands of
  each `step()`, keyed by step rather than by tick, because a paused step can
  carry commands without advancing the tick. Paused, empty steps are dropped -
  the simulation returns from them untouched - so a pause costs nothing.
  `replay.ts` plays a recording into a fresh `Simulation` and keeps the
  flight traces; a run that does not end in a game over on its last step is
  rejected, which is also what catches an old link after a physics change.
- **PLAY AGAIN builds a new simulation** (`session.ts`). The simulation's own
  `reset()` keeps its random streams running, so a second game could only be
  reproduced by replaying the first as well. A fresh `Simulation` per game
  makes each one `(seed, inputs)` on its own; the restart cues are the same
  ones `reset()` emits, and a test holds them equal.
- **A shared link is a recording** (`?run=`), not a score. The recipient's
  page replays it to get the ghost and the total, so the number shown is the
  simulation's, never the sender's. `MAX_RUN_STEPS` bounds what a hostile
  link can make a page compute.
- **The ghost** (`ghost.ts`) starts each shot when the player's shot of the
  same number leaves the pillow and runs tick for tick from there; the two
  games share no clock otherwise. It and the flags reach the renderers as an
  `Overlay` beside the snapshot (`render/scene/overlay.ts`).
- **The daily challenge** (`daily.ts`) seeds every game from the local date,
  so everyone gets the same powerups that day, and races the day's own best.

It keeps one `localStorage` key, `hamsterflight:v1` (`progress.ts`): records,
the day's best run, the streak, achievements and settings. It is not the
web-base storage layer - no IndexedDB, no schema - and it is only ever read
behind a try/catch: a browser that will not store is a game that forgets, not
one that breaks. The simulation may not touch storage; the lint rule and the
purity check still say so.

### The sim is pure, and that is enforced

`src/sim/**` must stay headless and deterministic. Three independent guards
keep it that way, and all of them are part of `bun run verify`:

- **`scripts/check-sim-purity.ts`** — a static check over the module graph.
- **A lint rule** — `.oxlintrc.json` scopes a `no-restricted-globals` deny-list to
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
| No React / router / storage / layout / PWA | It is a canvas game. One `localStorage` key in `src/app/` is not the storage layer. |
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
bun run smoke    # opens the built page in Chromium — shader link, asset 404s,
                 # and a first visit: the board, Play Now!, every sound loading
```
