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
npm run verify       # lint, sim purity, typecheck, tests, build
```

Click or press <kbd>Space</kbd> to jump, click again to hit the pillow, then
hold to glide. <kbd>P</kbd> pauses. Append `?seed=12345` to replay an exact run.

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
src/app/          the fixed-timestep loop, the only place that reads a clock
src/render/       Renderer interface plus two backends; read snapshots, cannot reach the simulation
src/input/        DOM events to discrete commands
src/assets/       sprite frames plus the generated placement manifest
reference/        research artifacts - decompilate, analysis, tools. Not a build input.
test/             physics specs; test/sim/ordering.spec.ts is the fidelity guard
scripts/          sim purity check, strategy bench
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
measured spike which found Pixi costs 153.8 kB gzip and only overtakes Canvas2D
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
which columns survive that and which do not.

## Assets

The sprites under `src/assets/sprites/` are extracted from the original SWF by
`reference/tools/build_sprites.py`, which also emits
`src/assets/sprites.generated.ts`. That manifest carries each sprite's frame
count and, crucially, the `ox`/`oy` offset of the image relative to the entity
position - the offsets Flash itself used - so the renderer contains no
per-sprite magic numbers.

The 382 frames ship as **one packed atlas sheet** rather than 382 files. Boot
went from 382 HTTP requests to one, the payload from 2.0 MB to 577 kB, and the
WebGL backend can batch every sprite into a single draw call because they all
live on one GPU texture. The manifest records each frame's rectangle within the
sheet; `w`/`h` are shared across a sprite's frames because ffdec crops them all
to the same box.

Placement is measured twice rather than trusted once. The offset comes from the
root transform of ffdec's SVG sprite export, which is exact and unrounded and is
produced by the same tool that rasterised the PNGs. `reference/tools/sprite_bounds.py`
computes the same quantity independently by walking the display list, and
`verified` records whether the two agree - 26 of 32 do. The six that do not are
nested clips whose geometry the display-list walk mis-resolves; they still use
ffdec's value, so `verified: false` marks a disagreement worth investigating
rather than a fallback.

Regenerate with:

```sh
ffdec -format sprite:svg -export sprite reference/extracted/svg \
  path/to/OCybCA4ADbpTKT.swf

python3 reference/tools/build_sprites.py path/to/OCybCA4ADbpTKT.swf \
  reference/extracted src/assets/sprites --svg-dir reference/extracted/svg
```

`--scale N` packs the art at N times stage size, rendered from the vector source
rather than upscaled. The manifest then carries `scale`, and the renderers draw
each frame back down to its stage box, so nothing moves. At 2x the sheet has to
grow to 4096 - `hit/zero` alone is 36 frames of 334x376, more than a 2048 sheet
holds, and a sprite's frames must stay on one sheet for the WebGL backend to
keep batching them into a single draw call. Requires Pillow and cairosvg.

Without `--svg-dir` the tool falls back to the display-list walk and centres the
six unresolved clips on their registration point, which misplaces them by up to
63 px.

**On rights:** this artwork is the original publisher's, not this project's.
Section 13.4 of the analysis document notes that shipping it in a published
project is a different matter from analysing it privately, and that remains
true - it is a deliberate choice by the repository owner, not an oversight. The
asset layer is data-driven behind a single manifest, so replacing the art with
original or licensed work is a data change rather than a rewrite. The SWF itself
is never committed.

## Deploying

Cloudflare Workers with the static-assets binding - no Worker code, so no
invocations are billed:

```sh
npm run deploy        # verify, then wrangler deploy
npm run preview:cf    # build, then serve dist/ through wrangler with real asset semantics
```

Or connect the repository in the Cloudflare dashboard (Workers & Pages → Import
a repository) with build command `npm run verify` and no deploy command
override. Making the build command `verify` rather than `build` means a red test
fails the deploy, which matters because Workers Builds does not wait for GitHub
checks.
