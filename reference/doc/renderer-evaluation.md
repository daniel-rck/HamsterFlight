# Would PixiJS bring anything?

Short answer: **no, not at this game's draw load.** Pixi starts winning at
roughly 100x the number of things HamsterFlight actually draws, and costs
153.7 kB gzip - about 10x the entire rest of the app - to get there.

This document records the measurements rather than the argument. The spike that
produced them lives on the branch as a second renderer behind
`?renderer=pixi`; it is a measuring instrument, not a migration.

## What the game actually draws

`GameRenderer` issues roughly 20-25 operations per frame on a 600x400 stage:
one sky gradient, two ground slabs, ~4 bushes, the pillow, 1-2 distance
markers, up to ~6 powerups, the hamster and its shadow, and ~10 pieces of HUD.
The star field adds 70 arcs when the hamster is high enough to see space.

There is no batching bottleneck, no overdraw, and no filter work. Rendering
also snaps to the 20 Hz simulation by design (see `porting-notes.md`), because
the original stage ran at 19 fps with no tweening.

## Method

Both backends draw the same scene - every layer, the same `ox`/`oy` offsets,
the same alphas - because a backend that skips work is faster for uninteresting
reasons. Both consume the identical 382 `ImageBitmap`s from the shared
`AssetLoader`, so this measures renderers and not the asset pipeline.

`FrameProfiler` wraps `renderer.draw()` from `main.ts`, outside both
implementations, so neither can be instrumented more kindly than the other. The
first window of every run is discarded as warmup.

`?stress=N` multiplies only what the *renderer* invents - bush density, star
count, and how many times each powerup is drawn. It never touches the
simulation, so a given seed produces the identical trajectory at every setting.
Both backends implement it the same way. Stress 1 is the real game.

Reproduce with:

```sh
npm run build
npm run bundle:report                      # bundle cost
STRESS=1,4,16,64,256 npm run bench:renderers   # frame cost
```

## Bundle cost

The Pixi backend is behind a dynamic `import()`, so it lands in its own chunks
and one build measures both. `dist/index.html` carries no `modulepreload` for
them: a normal visitor never downloads Pixi.

| | raw | gzip |
| --- | ---: | ---: |
| app entry chunk (every visitor) | 50.6 kB | **14.9 kB** |
| Pixi backend (13 lazy chunks) | 523.3 kB | **153.7 kB** |

Tree-shaking helps - the full `pixi.js@8.20.1` browser bundle is 820 kB raw /
231 kB gzip - but what is left is still **10.3x the entire rest of the game**.
For reference, all of `src/` including comments gzips to 24 kB.

`vite.config.ts` sets `chunkSizeWarningLimit: 400` with the comment "Fail
loudly rather than silently shipping a bloated bundle". No individual chunk
trips it, because Vite splits Pixi across 13 files - which is worth knowing:
the guardrail measures chunks, not dependencies.

## Frame cost

Chromium 1194, `?seed=12345`, 40-frame windows, 16 s per configuration,
median across windows. **Software rasteriser** - see the caveat below.

Draws per frame are `70N` stars (only above the altitude where space appears)
+ `~3.9N` bushes + up to `6N` powerups + ~15 fixed.

| stress | draws/frame | canvas2d p50 | pixi p50 | canvas2d p95 | pixi p95 | canvas2d fps | pixi fps |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 25 on the ground, ~95 in flight | **0.200 ms** | 0.350 ms | **0.300 ms** | 0.950 ms | 61.6 | 24.7 |
| 4 | ~340 | **0.200 ms** | 0.400 ms | **0.300 ms** | 1.000 ms | 55.8 | 22.4 |
| 16 | ~1 300 | **0.300 ms** | 0.500 ms | **0.500 ms** | 1.300 ms | 44.1 | 20.0 |
| 64 | ~5 100 | 2.200 ms | **1.100 ms** | 4.050 ms | **3.100 ms** | 8.9 | 12.8 |
| 256 | ~20 000 | 4.800 ms | **0.900 ms** | 18.500 ms | **1.400 ms** | 5.4 | 7.3 |

**The crossover sits between stress 16 and 64 - somewhere around 1 500 to 5 000
drawn objects per frame.** The game draws 25.

Below the crossover Pixi is consistently the slower of the two, by 0.15-0.2 ms
per frame. That is its retained scene graph being maintained and traversed:
real work, hardware-independent, and pure overhead when the scene is this
small. Above the crossover the picture inverts exactly as expected - immediate
mode re-issues every operation each frame while Pixi re-submits batched
geometry, so Canvas2D's p95 degrades 37x from stress 16 to 256 and Pixi's
barely moves.

### Caveat: no GPU in the measurement environment

These numbers come from a container with no `/dev/dri`, so WebGL runs on
SwiftShader - Chromium's software rasteriser. That penalises Pixi for reasons
unrelated to its design. It shows up in how little the fps column rewards
Pixi where it wins: at stress 256 its p50 is 5.3x better than Canvas2D's, but
its frame rate is only 1.4x better (7.3 vs 5.4), because rasterisation and
presentation happen outside the measured `draw()` call and SwiftShader does
both on the CPU. Pixi also never reaches a good absolute frame rate here - 24.7
fps at stress 1, against 61.6 for Canvas2D - which is the software rasteriser,
not the library.

So read the p50/p95 columns, which are CPU-side submission cost and travel
across hardware, and treat the fps column as a floor for Pixi rather than a
verdict. On a real GPU Pixi's absolute numbers improve and its post-crossover
lead widens; what would not change is the sub-crossover gap, because that is
scene-graph bookkeeping on the CPU, not rasterisation.

`npm run bench:renderers` on a machine with a GPU settles it in one command.
`CHROMIUM_EXECUTABLE` points the harness at an existing Chromium if the
Playwright-managed one is not available.

## Visual parity

Checked with `?seed=12345&debug` in both backends: sprite placement from the
generated `ox`/`oy`, hamster rotation, shadow scaling, powerup `taken`
transparency, the HUD, the distance markers and the debug hitboxes all land
identically. Two deliberate implementation differences:

- The sky gradient is a static top-to-bottom alpha ramp tinted per frame, not a
  `FillGradient`. Pixi's own documentation warns against allocating a gradient
  per frame, and with two colour stops a tinted ramp is exact.
- The star field is baked into a single `Graphics` once, because its positions
  come from a fixed hash. Canvas2D re-paths all 70 arcs every frame. This is a
  genuine property of retained mode - but it is also an optimisation Canvas2D
  could adopt with an offscreen canvas and has not, so it flatters Pixi
  slightly in the high-stress rows.

## What would change the answer

Pixi becomes the right call if the renderer ever needs:

- **Thousands of sprites** - a real particle system, not the handful of `fx/*`
  frames the original used.
- **Full-screen shader effects** - displacement, bloom, colour grading. Canvas2D
  has no equivalent, and this is the one capability gap that is not about speed.

The unported work that does exist - the clouds (`cloud/1..3`, in the manifest
but never drawn), the parallax hills from `GameCamera.as:213`, and the `fx/*`
impact animations - adds perhaps a dozen sprites. That is stress 2, nowhere
near the crossover.

## The cost that is actually real

Unrelated to Pixi, and worth more than this whole question: the game loads
**382 individual PNG frames (2.0 MB) as 382 separate `fetch` calls**, and
`AssetLoader.loadSprites` awaits them sequentially *within* each sprite id, so
`hamster/jump`'s 36 frames load one after another. Parallelism only exists
across the 32 sprite ids.

A texture atlas - `reference/tools/build_sprites.py` already emits the manifest
and could pack the sheet - plus a parallel load loop would cut boot from 382
round trips to a handful. Both renderers would benefit equally.

## Reverting the spike

If the answer stands, the spike removes cleanly: delete `src/render/PixiRenderer.ts`,
`scripts/bench-renderers.mjs`, drop `pixi.js` and `playwright` from
`package.json`, and remove the `?renderer=` branch in `src/main.ts`. Worth
keeping either way: `src/render/Renderer.ts`, `src/app/FrameProfiler.ts`,
`scripts/bundle-report.mjs`, and the `?stress=` knob.
