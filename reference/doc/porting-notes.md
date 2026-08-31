# Porting notes

Divergences between this port, the original bytecode, and the two earlier
artifacts in `reference/`. Anyone comparing numbers against
`flight-of-the-hamsters-reverse-engineering.md` section 12 should read this
first.

## `reference/legacy/sim.js` is wrong in three ways

`sim.js` produced the strategy table in section 12 of the document. It is a
paraphrase of the AS2, not a transcription, and it diverges from
`reference/as2/Game.as` in three places that all affect trajectories. Each is
pinned by a test in `test/sim/ordering.spec.ts`.

### 1. Gravity is applied before the ground test

`sim.js` lines 60-63 do `xvel *= 0.99; yvel += grav` and *then* test
`y + yvel >= 950`. `Game.onUpdate` runs `checkCollision()` at step 3
(Game.as:505) and does not add gravity until step 6 (Game.as:606), so the real
prediction uses the **previous** tick's `yvel`. Every ground contact in `sim.js`
happens one gravity step early.

### 2. The impact angle is not `atan2(yvel, xvel)`

`sim.js` line 65 computes `atan2((y + yvel) - y, xvel)`, i.e. `atan2(yvel, xvel)`.
The original (Game.as:799-801) is:

```actionscript
_loc10_ = this.bc._x - this.blt.ox;
_loc9_  = (this.bc._y + this.blt.yvel) - this.blt.oy;
_loc2_  = Math.atan2(_loc9_, _loc10_);
```

`Bullet.update()` captures `ox`/`oy` *before* moving (Bullet.as:42-43), so the
vertical delta spans two ticks (`yvel_prev + yvel_now`) while the horizontal
delta spans one. The computed angle is therefore far steeper than the physical
descent angle, and the 70 degree faceplant threshold trips at a shallower real
approach than the constant suggests.

Consequence: `ox`/`oy` are physics state on the entity, with the original's
capture timing. They are not a rendering convenience.

### 3. The glide lift is frozen, not recomputed

`Bullet.increaseGravity()` is called from exactly one place - `onMouseDown`
(Game.as:1040). `blt.grav` is then frozen at `-0.17 * xvel` as measured at the
instant of the press and stays there for the whole hold, even as drag eats
`xvel` at 1% per tick. `sim.js` line 59 recomputes it every tick.

This is why input reaches the simulation as discrete `press`/`release`
commands rather than a sampled boolean: a boolean cannot distinguish "pressed
this tick" from "still holding", so it cannot express the behaviour at all.

`Tuning.recomputeGlidePerTick` exists to switch to the `sim.js` reading, because
it changes the optimal strategy and therefore the golden values. Default is
`false`, the faithful behaviour.

Two smaller ones: `sim.js` line 41 builds a garbled spawn `x` that line 42
immediately overwrites (the correct value is `800 - camX`, i.e. `bulletX + 650`),
and it approximates every hitbox as a 40 px half-extent - see below.

## Section 12's numbers are not usable as expected values

Because of the three divergences above **and** the hitbox correction below, a
faithful port does not reproduce 13 / 45 / 46 ft medians or the 313 ft maximum.
`test/golden/strategies.spec.ts` therefore asserts the *shape* the document and
the game's own help text describe - mashing flies high and short, measured
holding flies far - and prints the current table rather than pinning it to
values derived from a divergent simulation.

## Hitboxes are now measured, not approximated

Document section 13.1 lists the `core` bounds as an open gap.
`reference/tools/extract_hitboxes.py` closes it: Flash `hitTest` is an AABB test,
and the real bounds are recoverable by unioning the child `DefineShape` bounds
through the `PlaceObject2` matrices, **with scale applied** - the `core` clips
are scaled between 1.08 and 1.97, which is what makes the naive reading wrong.

| Symbol | source | half-extents |
|---|---|---|
| `node` (powerup cores, jump hamster) | DefineSprite 52/454/462/463/465/466 -> char 45 | 8.0 to 13.73 |
| flight `core` | DefineSprite 331 -> char 205, scale 1.08 | 19.90 x 32.50 |
| `_wind` `core` | DefineSprite 467 -> char 391, scale 1.69/1.97 | 18.06 x 30.00 |
| `pillow` | char 234, tested as a whole clip | 21.50 x 27.10 |

`sim.js` used 40 px on both axes. Against the real flight core the x window is
`19.90 + 8.0 = 27.9` and the y window `32.50 + 8.0 = 40.5`, so its x window was
about 1.4x too generous and powerup pickup rates in section 12 are optimistic.

### Two consequences worth knowing

**The launch window is y in [694.7, 776.4].** It follows from the jump-phase
`core` (half-extent 13.73, centre offset +1.07/+5.32) against the whole pillow
clip at (140, 740.9).

**Not every jump can reach it.** `yvel` starts in -14..-10 and the one-shot boost
adds -19..-15, so the apex spans roughly 660 (best rolls) to 840 (worst) - the
document's "apex at about 726" is a mid-range figure, not a bound. Measured over
1000 seeds, **68% of jumps can reach the pillow**; the rest are unavoidable
faceplants. That is a consequence of the extracted geometry, not a decision, and
it is the main open calibration item: `core` sits inside a multi-frame hamster
sprite and the extractor reads the placement from the first frame it finds. If
the clip moves its `core` during the jump animation, the window is wider than
this. `test/golden/reachability.spec.ts` pins the share so recalibration shows
its effect immediately.

## Quirks reproduced on purpose

| Original | Decision |
|---|---|
| `pi = 3.141593` instead of `Math.PI` | **Reproduced.** Used for every degree/radian conversion; keeps angle maths bit-stable. Also forbids `Math.hypot` in favour of `sqrt(dx*dx + dy*dy)`. |
| `powerupMark = 650` in `init`/`reset` but `600` in `cleanUpItems` | **Reproduced.** Shifts the first spawn of turns 2-5 by 50 px, which is observable. |
| `speed` and `wind` have no re-entry guard; `bounce`, `slide`, `superbounce`, `rebound` do | **Reproduced.** A multi-tick overlap really does apply speed repeatedly. |
| Faceplant branch also requires `!slide` (Game.as:803) | **Reproduced.** The document's section 10 omits it. |
| `xvel *= 1 + this.f` for superbounce | **Reproduced as written**, not as the literal 1.6. |
| Impact angle exactly 70 degrees | **Reproduced.** Falls through to the final `else`, since it is neither `< 70` nor `> 70`. |

## Quirks deliberately dropped

| Original | Decision |
|---|---|
| `!this.bounce & !this.superbounce` - bitwise `&` (Game.as:608) | Written as `&&`. Provably identical for boolean operands. |
| `glideVals` - 25 hand-tuned values (Game.as:145) | Not ported. Written once, never read. |
| `Bullet.deleteBlt()` with body `false;` | Method dropped, but its emptiness was load-bearing: `onShotDone` calls it and the projectile must survive so the outcome clip can be placed and `bc._x` still read for scoring. Modelled as a lifetime rule instead. |
| `increaseGravity(n)` ignoring `n` | Parameter removed, behaviour kept. Renamed `setGlideGravity()`. |
| `checkPowerUpsColl` culling with `shift()` while indexing with an un-decremented counter (Game.as:680-684) | Dropped: it silently skipped one entry. Culling from the front is correct and is what the code meant. |
| `loadTracker()` - loads a third-party analytics SWF | Dropped. |
| `XML_Loader` / `plotNodes` / `gameData` | Dropped. Nothing in `onUpdate` reads it; it looks like an editor artifact. |
| `MyDispatcher` / `mx.events.EventDispatcher` | Replaced by the returned `SimEvent[]`. |
| `generateVehicle` | Dropped - never called from anywhere in the 1512 lines. |
| `radainsToDegrees` typo | Renamed `radToDeg`, original name noted in a comment. |

## Deliberate architectural divergences

**Separate RNG streams.** The original drew jump rolls, powerup rolls and
decoration from one shared `Math.random` stream. This port forks independent
streams for `jump` and `powerups`, and keeps decoration out of the simulation
entirely. Unobservable - the original's seed is unknowable - and it means adding
or changing decoration cannot invalidate a physics golden. Do not "fix" this
back without regenerating every golden.

**Decoration lives in the renderer.** Clouds and bushes are drawn, never
simulated. Nothing in the physics path reads them.

**Rendering snaps rather than interpolating.** The original stage ran at 19 fps
with no tweening, so snapping to the 20 Hz simulation is the faithful look, and
it means about 20 draws per second instead of 60.

## Determinism policy

All arithmetic is IEEE-754 double, the same as AS2 `Number` - which is why
JavaScript is the semantically closest target for this port. `+ - * /` and
`sqrt` are bit-exact everywhere, but **`sin`, `cos` and `atan2` are not
guaranteed bit-identical across engines or architectures.** Therefore:

- assert integers exactly (`feet`, tick counts, glide points);
- assert floats with `toBeCloseTo`;
- quantise any trajectory snapshot before comparing.

A golden that shifts by exactly 1 ft on a different machine is a landing sitting
on the `Math.floor` boundary, not a regression. Note the seed and re-pin.
