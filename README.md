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
| `?renderer=pixi` | the experimental PixiJS backend (see below) |
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

## The PixiJS question

`src/render/PixiRenderer.ts` is a spike, not a migration: a second backend
behind `?renderer=pixi`, built so the question "would a WebGL engine help?"
could be measured instead of argued. It is loaded through a dynamic import, so
a normal visitor never downloads it.

The answer is no. Pixi costs 153.7 kB gzip - 10x the rest of the app - and only
overtakes Canvas2D somewhere between 1 500 and 5 000 drawn objects per frame.
This game draws about 25. `reference/doc/renderer-evaluation.md` has the full
table, the method, and the caveats.

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

Placement is cross-checked rather than trusted. The offsets are computed from a
display-list walk (`reference/tools/sprite_bounds.py`) and compared against the
dimensions ffdec actually rasterised; agreement sets `verified: true`, and the
26 of 32 sprites that agree use the exact offset. The six that disagree - nested
clips that animate their own scale - are marked `verified: false` and centred on
the registration point instead.

Regenerate with:

```sh
python3 reference/tools/build_sprites.py path/to/OCybCA4ADbpTKT.swf \
  reference/extracted src/assets/sprites
```

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
