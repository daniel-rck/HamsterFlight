# HamsterFlight

A faithful browser port of the Flash game *Flight of the Hamsters*,
reconstructed from bytecode analysis of the original AVM1/ActionScript 2 SWF.

Not affiliated with the original publisher. The sprites are extracted from the
original SWF and remain the copyright of their respective owners - see
[Assets](#assets).

## Quick start

```sh
bun install
bun run dev          # http://localhost:5173
bun run verify       # lint, sim purity, atlas, typecheck, tests, build, bundle budget
```

Bun is the package manager, like the other apps in this family
(`daniel-rck/web-base`); Node runs the scripts under `scripts/`.

Press <kbd>Space</kbd> or click to jump, again to hit the pillow, then hold to
glide. One swing per jump: miss it and the hamster lands back on the pad and
you jump again, which costs nothing - only the pillow ends a turn.
<kbd>P</kbd> pauses, <kbd>H</kbd> toggles the hitbox overlay. The keyboard works
from the first keystroke; no click on the stage is needed first. Append
`?seed=12345` to replay an exact run.

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
  PoseClock.ts      the hamster's clip frame, anchored to the phase rather than to a free clock
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
not its numbers. Run `bun run bench` for the current table.

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
bun run bundle:report                          # per-chunk gzip cost
STRESS=1,4,16,64,256 bun run bench:renderers   # frame cost, both backends
```

The benchmark drives a real browser through a scripted flight. Numbers taken
without a GPU are software-rasterised and understate Pixi; the document says
which columns survive that and which do not. The exact kilobyte figures in
the prose are from the evaluation; `bun run bundle:report` has the current
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

The frames - 526 of them across 40 sprites, as `bun run check:assets` reports -
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

`.github/workflows/ci.yml` gates every pull request and every push to `main`.
It does not deploy; see [Deploying](#deploying).

| Job | Checks |
| --- | --- |
| `ci` | the shared workflow from `daniel-rck/web-base`: Biome, three tsconfigs, the tests, the build |
| `checks` | what only this app has: sim purity, atlas integrity, the bundle budget |
| `smoke` | opens the built page in Chromium, in both modes on both backends; then serves it through `wrangler dev` and checks the headers, the immutable caching and the real 404s |

Everything in `ci` and `checks` is `bun run verify` locally, so a green local
run means green jobs. The smoke test is separate because it costs a browser:
run it yourself with `bun run build && bun run smoke`, and `bun run check:cf`
for the Cloudflare half.

Two of these exist because of bugs that got through everything else. The scene
shader did not link on its first build - a run-time GPU failure no typecheck can
see - so `smoke` opens the page. And the atlas is a build artifact nothing
downstream can regenerate, because `build_sprites.py` needs the SWF, so
`check:assets` verifies the manifest and the sheets still agree with each other.

### Making them gates

Until `main` is protected, the checks report but do not block. Under **Settings →
Rules → Rulesets → New branch ruleset**, targeting `main`:

- *Require a pull request before merging*
- *Require status checks to pass*, adding `ci`, `checks` and `smoke`, plus
  *Require branches to be up to date before merging*

## Deploying

Cloudflare Workers with the static-assets binding - no Worker code, so no
invocations are billed. **Cloudflare Workers Builds deploys every push to
`main`** through the dashboard's Git integration; nothing deploys from GitHub
Actions. The step-by-step setup, including the one setting that is easy to get
wrong, is in **[SETUP.md](SETUP.md)**.

By hand, with the same gates CI applies:

```sh
bun run verify && bun run smoke && bun run check:cf
bun run worker:deploy                  # wrangler deploy
bun run build && bun run worker:dev    # serve dist/ through wrangler locally, real header and 404 semantics
```

The build emits source maps but does not reference them from the bundle
(`sourcemap: 'hidden'`), so a deployed stack trace can be mapped by hand
against the stamped commit without handing every visitor the source.

Every build stamps its commit and date into the page - shown under the stage and
logged on boot - so a deployed page can always be traced back to a commit. A
trailing `+` on the hash means the tree was dirty when it was built.
