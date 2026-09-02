# HamsterFlight

A faithful browser port of the Flash game *Flight of the Hamsters*,
reconstructed from bytecode analysis of the original AVM1/ActionScript 2 SWF.

Not affiliated with the original publisher. The sprites are extracted from the
original SWF and remain the copyright of their respective owners - see
[Assets](#assets).

## Quick start

```sh
npm install
npm run dev          # http://localhost:5173
npm run verify       # lint, sim purity, atlas, typecheck, tests, build, bundle budget
```

Press <kbd>Space</kbd> or click to jump, again to hit the pillow, then hold to
glide. <kbd>P</kbd> pauses, <kbd>H</kbd> toggles the hitbox overlay. The
keyboard works from the first keystroke; no click on the stage is needed first.
Append `?seed=12345` to replay an exact run.

| query parameter | effect |
| --- | --- |
| `?seed=12345` | replay an exact run |
| `?debug` | hitboxes and a state readout (<kbd>H</kbd> toggles) |
| `?mode=faithful` | the Canvas2D reference renderer, nothing added |
| `?renderer=pixi` \| `canvas2d` | pick a backend explicitly, overriding the mode |
| `?stress=N` | multiply renderer-only decoration; profiling aid, never touches physics |
| `?profile` | report draw-time percentiles to the console |

## What makes this port unusual

**The physics runs at a fixed 20 Hz and that is not negotiable.** The original
drove both phases from `setInterval(..., 50)`, so every acceleration in the game
is a per-tick value rather than a per-second one. Delta-time integration
produces visibly different trajectories and different scores. The stage's 19 fps
only ever affected MovieClip animation.

**The simulation is pure.** Everything under `src/sim/` is headless and
deterministic: no DOM, no clock, no `Math.random`. That is enforced rather than
merely intended - `tsconfig.sim.json` compiles it with no DOM lib and no ambient
types at all, and `scripts/check-sim-purity.mjs` catches the non-determinism a
typechecker cannot see. Given a seed and a command stream the trajectory is
reproducible, which is what makes the regression tests possible.

**Input is discrete, not sampled.** `Bullet.increaseGravity()` is called once
per press and freezes the glide lift at the horizontal speed measured at that
instant. A sampled "is the button held" boolean cannot express that, so commands
are `press` / `release` events.

## Layout

```
src/sim/          pure, deterministic simulation - no DOM, no clock, no Math.random
  constants.ts      values read out of the bytecode; changing one is a bug
  tuning.ts         values the bytecode does NOT contain; calibratable, injected
  hitboxes.generated.ts   AABB bounds extracted from the SWF shape records
  phases/           jump, launch, flight - the 12-step tick in original order
  systems/          ground collision, powerup spawn and pickup, camera
  drive.ts          plays whole shots under a button policy; the golden tests and the bench share it
src/app/          the fixed-timestep loop (the only place that reads a clock), URL parameters, build stamp
src/render/       Renderer interface plus two backends; read snapshots, cannot reach the simulation
  scene/            what to draw, as pure functions of the snapshot - both backends consume it
  pixi/             the Pixi backend's texture cache, HUD, filters and pools
  interpolate.ts    places the hamster and camera between two ticks for the frame in between
src/input/        DOM events to discrete commands
src/assets/       sprite frames plus the generated placement manifest
reference/        research artifacts - decompilate, analysis, tools. Not a build input.
test/             physics specs; test/sim/ordering.spec.ts is the fidelity guard
scripts/          the checks CI runs (purity, atlas, bundle budget, smoke, Cloudflare semantics)
                  and the two benches; TypeScript, run directly by Node
```

The split between `constants.ts` and `tuning.ts` is the important one: it makes
the epistemic status of every number visible. `C` is measured fact. `Tuning` is
a calibratable guess, injected rather than imported, so recalibrating is a data
change.

## Numbers from the analysis are not expected values

`reference/doc/porting-notes.md` documents every divergence. The short version:
the strategy table in section 12 of the analysis was produced by
`reference/legacy/sim.js`, which diverges from the bytecode in three ways - tick
order, impact-angle derivation, and the frozen glide lift. Its hitboxes were
also a 40 px approximation, where the real bounds are now extracted from the
shape records. So the tests assert the qualitative shape the analysis describes,
not its numbers. Run `npm run bench` for the current table.

## Two renderers

`enhanced` is the default and runs on PixiJS, because WebGL is what can carry
shaders and particle effects; `?mode=faithful` gives the Canvas2D renderer
drawing exactly what the original stage drew.

That was not the first answer. `reference/doc/renderer-evaluation.md` records a
measured spike which found Pixi costs about 158 kB gzip and only overtakes Canvas2D
somewhere between 1 500 and 5 000 drawn objects per frame - where this game
draws about 25. On throughput alone the answer was no. It changed when effects
entered the picture: Canvas2D has no shader path at all, so the cost now buys a
capability rather than speed. The evaluation document still holds the numbers,
including the ones that argue against.

```sh
npm run bundle:report                          # per-chunk gzip cost
STRESS=1,4,16,64,256 npm run bench:renderers   # frame cost, both backends
```

The benchmark drives a real browser through a scripted flight. Numbers taken
without a GPU are software-rasterised and understate Pixi; the document says
which columns survive that and which do not. The exact kilobyte figures in
the prose are from the evaluation; `npm run bundle:report` has the current
ones, and `check:bundle` fails the build when they grow past their budget.

## What is drawn, and what departs from the original

Both renderers draw from `src/render/scene/`, so they show the same picture by
construction rather than by keeping two copies in step. Three things are
presentation choices that the original stage did not make:

- **Interpolation.** The physics snaps at 20 Hz; the picture does not. Each
  frame places the hamster and the camera between the last two ticks by how far
  into the current tick it falls, in both modes. The original ran at 19 fps
  with no tweening. Nothing in the simulation or the scores is touched.
- **`prefers-reduced-motion`.** Camera shake, chromatic aberration, the
  shockwave, motion blur and the particles switch off when the OS asks for
  less motion. The rest of the enhanced presentation stays.
- **No WebGL, no problem.** If the browser cannot give a WebGL context, or
  Pixi fails to start, the Canvas2D renderer takes over and says so in the
  console. Nobody gets a blank page for want of a GPU.

## Assets

The sprites under `src/assets/sprites/` are extracted from the original SWF by
`reference/tools/build_sprites.py`, which also emits
`src/assets/sprites.generated.ts`. That manifest carries each sprite's frame
count and, crucially, the `ox`/`oy` offset of the image relative to the entity
position - the offsets Flash itself used - so the renderer contains no
per-sprite magic numbers.

The frames - 526 of them across 40 sprites, as `npm run check:assets` reports -
ship as **packed atlas sheets** rather than one file each. Boot went from
hundreds of HTTP requests to one, and the WebGL backend can batch every sprite
into a single draw call because they all live on one GPU texture. The manifest records
each frame's rectangle within the sheet; `w`/`h` are shared across a sprite's
frames because ffdec crops them all to the same box.

Two densities are built - about 760 kB at 1:1 and 1.9 MB at 2x - and the loader
takes the smallest that still covers the display. Most screens lay the stage out wider
than its 600 px design size, so most visitors get the 2x sheet: sharper art for
about a megabyte more. Dropping back to one density is a `--densities 1` rebuild.

Placement is measured twice rather than trusted once. The offset comes from the
root transform of ffdec's SVG sprite export, which is exact and unrounded and is
produced by the same tool that rasterised the PNGs. `reference/tools/sprite_bounds.py`
computes the same quantity independently by walking the display list, and
`verified` records whether the two agree - 33 of 40 do. The seven that do not
are nested clips whose geometry the display-list walk mis-resolves; they still use
ffdec's value, so `verified: false` marks a disagreement worth investigating
rather than a fallback.

Regenerate with:

```sh
ffdec -format sprite:svg -export sprite reference/extracted/svg \
  path/to/OCybCA4ADbpTKT.swf

python3 reference/tools/build_sprites.py path/to/OCybCA4ADbpTKT.swf \
  reference/extracted src/assets/sprites --svg-dir reference/extracted/svg
```

`--densities 1,2` emits one sheet per density from a single 1:1 layout, so the
denser sheet is the same rectangles multiplied and one manifest serves both. The
loader picks by how large the stage actually is, and the renderers draw each
frame back down to its stage box - so raising the density changes sharpness and
nothing else. Requires Pillow and cairosvg.

Without `--svg-dir` the tool falls back to the display-list walk and centres the
six unresolved clips on their registration point, which misplaces them by up to
63 px.

**On rights:** this artwork is the original publisher's, not this project's.
`LICENSE` (MIT) covers the original code and documentation; `NOTICE` lists what
it does not.
Section 13.4 of the analysis document notes that shipping it in a published
project is a different matter from analysing it privately, and that remains
true - it is a deliberate choice by the repository owner, not an oversight. The
asset layer is data-driven behind a single manifest, so replacing the art with
original or licensed work is a data change rather than a rewrite. The SWF itself
is never committed.

## What the pipeline checks

`.github/workflows/ci.yml`, on every pull request and every push to `main`:

| Job | Checks |
| --- | --- |
| `verify` | `npm run audit` over runtime dependencies, then `npm run verify`: Biome, sim purity, atlas integrity, three tsconfigs, the tests, the build, and the bundle budget |
| `actionlint` | the workflow file itself |
| `smoke` | opens the built page in Chromium, in both modes on both backends; then serves it through `wrangler dev` and checks the headers, the immutable caching and the real 404s |
| `dependency-review` | dependencies this pull request *adds* (pull requests only, opt-in) |
| `gate`, `deploy` | `wrangler deploy`, on pushes to `main` only, gated on `verify` and `smoke` and switched on by the secret |

`npm run verify` locally is the `verify` job minus the audit, which is one step
away from it as `npm run audit` because an advisory database update can turn a
green tree red without a code change. The smoke test is separate because it
costs a browser: run it yourself with `npm run build && npm run smoke`, and
`npm run check:cf` for the Cloudflare half. Actions are pinned to commit SHAs
and Dependabot moves them.

Two of these exist because of bugs that got through everything else. The scene
shader did not link on its first build - a run-time GPU failure no typecheck can
see - so `smoke` opens the page. And the atlas is a build artifact nothing
downstream can regenerate, because `build_sprites.py` needs the SWF, so
`check:assets` verifies the manifest and the sheets still agree with each other.

### Making them gates

The checks report but do not block until `main` is protected. Under **Settings →
Rules → Rulesets → New branch ruleset**, targeting `main`:

- *Require a pull request before merging*
- *Require status checks to pass*, adding `verify` and `smoke`, plus *Require
  branches to be up to date before merging*

`ci.yml` cancels superseded runs, so a check can sit as *cancelled* rather than
*failed* while a newer run finishes. That is normal, and it does briefly look
like a failure in the UI.

`dependency-review` needs the repository's dependency graph, which is off:
switch it on under **Settings → Code security**, then add a repository variable
`DEPENDENCY_GRAPH` = `on` (Settings → Secrets and variables → Actions →
Variables). Until then the job does not run - it is skipped rather than made
non-blocking, because `continue-on-error` would also swallow the findings it
exists to surface.

## Deploying

Cloudflare Workers with the static-assets binding - no Worker code, so no
invocations are billed. Pushes to `main` deploy themselves once the repository
has a `CLOUDFLARE_API_TOKEN` secret (Settings → Secrets and variables → Actions)
created from the "Edit Cloudflare Workers" token template. Add
`CLOUDFLARE_ACCOUNT_ID` as well if the token can see more than one account.

By hand:

```sh
npm run deploy        # verify, smoke, check:cf, then wrangler deploy - the same gates CI applies
npm run preview:cf    # build, then serve dist/ through wrangler with real asset semantics
```

The build emits source maps but does not reference them from the bundle
(`sourcemap: 'hidden'`), so a deployed stack trace can be mapped by hand
against the stamped commit without handing every visitor the source.

### Cloudflare project settings

Connecting the repository in the dashboard (Workers & Pages → Import a
repository) needs exactly these:

| Field | Value |
|---|---|
| Build command | `npm ci && npm run verify` |
| Deploy command | `npx wrangler deploy` (the default) |
| Root directory | `/` |
| Node version | from `.nvmrc` |

**The build command is not optional, and leaving it empty is the failure that
looks like a broken deployment.** Workers Builds runs the deploy command on its
own if no build command is set, so `dist/` is never created and `wrangler`
stops with:

```
✘ [ERROR] The directory specified by the "assets.directory" field in your
  configuration file does not exist: /opt/buildhome/repo/dist
```

That is the build not having run, not a misconfigured `wrangler.jsonc`. On a
repository with no `package.json` at all the same situation reports itself
differently - `Could not detect a directory containing static files` - which is
the same root cause one step earlier.

`npm run verify` rather than `npm run build` as the build command is deliberate:
Workers Builds does not wait for GitHub checks, so running lint, the purity
check, the typechecks and the tests there is what stops a red commit from
reaching production.

### Or from GitHub Actions instead

`ci.yml` also has a `deploy` job that runs `npx wrangler deploy` on pushes to
`main`, gated on `verify` **and** `smoke`. It only runs when a
`CLOUDFLARE_API_TOKEN` repository secret exists (Settings → Secrets and
variables → Actions, from the "Edit Cloudflare Workers" token template; add
`CLOUDFLARE_ACCOUNT_ID` too if the token can see more than one account).

**Pick one of the two.** With the dashboard connected *and* the secret set,
every push deploys twice. The trade between them:

| | Workers Builds | the `deploy` job |
|---|---|---|
| Waits for GitHub checks | no | yes |
| Runs the browser smoke test | no - the build image has no browser | yes |
| Build minutes billed by | Cloudflare | GitHub |

The dashboard route runs `npm run verify` itself, so it does catch a red commit;
what it cannot catch is the one thing only a browser sees, which is why the
`deploy` job waits for `smoke`.

Every build stamps its commit and date into the page - shown under the stage and
logged on boot - so a deployed page can always be traced back to a commit. A
trailing `+` on the hash means the tree was dirty when it was built.
