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

`Tuning.recomputeGlidePerTick` switches to the `sim.js` reading - `stepFlight`
re-calls `setGlideGravity()` on every held tick before gravity - because it
changes the optimal strategy and therefore the golden values. Default is
`false`, the faithful behaviour; `ordering.spec.ts` shows the two diverge.

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

## Sprite placement is verified, not trusted

The art is extracted with `reference/tools/build_sprites.py`. ffdec crops each
sprite PNG to the sprite's bounds unioned over its frames, so drawing it where
Flash drew it needs that `(xmin, ymin)` offset relative to the registration
point. `reference/tools/sprite_bounds.py` computes it from a real display-list
walk - `PlaceObject2` can place a character *or* move one already at a depth
without naming it, and ignoring those move tags undercounts every animated clip.

The walker reads both placement tags. Skipping `PlaceObject3` - which this SWF
uses 24 times - made whole sprites look empty, `_bounce` and the launch tower
among them.

The authoritative offset is ffdec's own SVG export: each frame's root
`<g transform="matrix(1,0,0,1, tx, ty)">` shifts the art so its box starts at
the origin, so `(-tx, -ty)` is the offset, unrounded and produced by the same
tool that rasterised the art. The display-list walk is then a second opinion
rather than the source: 33 of 40 sprites agree and are marked
`verified: true`; the seven that do not are recorded, not papered over.

Two causes account for all seven. Five are clips the walker gets wrong: nested
children that animate their own scale, or a rotated placement, whose terms
`transform()` drops. Two are composed sprites (below) where the boxes are
*meant* to differ, because the tool crops them tighter than the declared
geometry; the build prints both boxes so the difference can be read rather than
guessed at.

One deliberate rendering divergence: the original sets
`_rotation = radToDeg(atan2(yvel, xvel)) + 90` because its art is authored
pointing up. The exported poses face right, so the `+ 90` is dropped and the
sprite aligns directly with the velocity vector.

## The pre-launch scene was missing, and why

For a long time the port drew a hamster and a pillow where the original has a
whole machine: a wooden tower, an operator swinging a pillow on a green pole,
two hamster wheels turning on windmill poles, four hamsters queuing to the left,
a launch meter and five shot pips.

It went missing because the reverse-engineering pass followed clip boundaries,
and **there is no launcher clip to follow.** None of it was ever a sprite in the
SWF: it is a band of loose layers inside `background_mc` (char 145), stacked
between the parallax hills and the starfield. A tool that walks `DefineSprite`
tags simply never sees it.

`build_sprites.py` composes those sprites itself now, selecting layers by
character id out of the parent's frame SVGs (`COMPOSED`, `Vector`), and
`Resolver.subset_bounds` walks the same selection through the display list so
the composed offsets get the same cross-check the plain ones get.

Layer bands, back to front, and where each ends up:

| Layers | Becomes |
|---|---|
| 81, 82, 88 - hills, sunset bar, starfield | dropped; the port draws its own sky and an endlessly scrolling ground |
| 90, 91, 92 - one cloud and two bush clumps | dropped; the port already scatters bushes and clouds along the whole course |
| the operator, pole, pillow and swing arcs | `launcher/swing`, 49 frames |
| 98, 99/121 - tower and wheel poles | `launcher/frame`, one frame |
| 114, 116 - the two hamster wheels | `launcher/wheel1`, `launcher/wheel2` |

Facts about the original worth writing down, all read from the SWF rather than
inferred:

- **There really are two pillows in the ready pose.** The one on the operator's
  pole is the backdrop's own art; the one beside it is `game_mc.pillow`
  (char 234), the clip `getPillowCollision` hit-tests. Both are on the display
  list, neither is hidden, and they overlap. The port drew both for a while and
  now draws only the first - see the divergence table below. The hit test is
  unaffected: it never read the drawn position.
- **`_root.background_mc.pillow._x = 117.3` in `onDone()` is a no-op.**
  `background_mc` has no child named `pillow`; the only instance of that name in
  the SWF is in `game_mc`. The line looks like a leftover from an earlier layout.
- **`launch()` runs on the second click**, so the pillow holds its rest position
  for the whole jump and only snaps to `PILLOW_LAUNCH_X` at the moment the
  collision test runs.
- **The queue moves 15 px per turn**, from `this._x += 15` on frame 26 of the
  `hWalkOut` clip - exactly one slot. The clip's `_x` is otherwise never
  written after `reset()`.
- **`background_mc`'s timeline stops at frames 1, 4 and 7**, and jumps to the
  `miss` label at 10. Frames 8 and 9 are never displayed: `getPillowCollision`
  jumps straight to `miss` in the same click that reached frame 5.

One divergence, on purpose: the original stops scrolling `background_mc` once
the camera passes 650 px (`GameCamera.as:80-83`), freezing the launcher where it
is. The port scrolls it with the rest of the world instead. By then the launcher
is off the left edge either way, and the port has no hills clip for it to stay
glued to.

## Quirks reproduced on purpose

| Original | Decision |
|---|---|
| `pi = 3.141593` instead of `Math.PI` | **Reproduced.** Used for every degree/radian conversion; keeps angle maths bit-stable. Also forbids `Math.hypot` in favour of `sqrt(dx*dx + dy*dy)`. |
| `powerupMark = 650` in `init`/`reset` but `600` in `cleanUpItems` | **Reproduced.** Shifts the first spawn of turns 2-5 by 50 px, which is observable. |
| `speed` and `wind` have no re-entry guard; `bounce`, `slide`, `superbounce`, `rebound` do | **Reproduced.** A multi-tick overlap really does apply speed repeatedly. |
| Faceplant branch also requires `!slide` (Game.as:803) | **Reproduced.** The document's section 10 omits it. |
| `xvel *= 1 + this.f` for superbounce | **Reproduced as written**, not as the literal 1.6. |
| Impact angle exactly 70 degrees | **Reproduced.** Falls through to the final `else`, since it is neither `< 70` nor `> 70`. |
| The queue's step and its 15 px move happen on different frames | **Reproduced.** Frame 26 does both at once, so the hamster appears to snap back 8 px as it moves up a slot. |

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
| Two overlapping pillows in the ready pose | The `game_mc.pillow` clip is no longer drawn. Both are visible in the original, but the static one reads as a rendering fault once the operator swings the other away, and it carries no information: the hit test uses `PILLOW_LAUNCH_X` regardless of where the clip is drawn. `C.PILLOW_REST_X` is kept as the measured value with no reader. |
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
simulated. Nothing in the physics path reads them. The pre-launch scene follows
the same rule: `PreLaunchScene` derives every frame number from the snapshot and
the event stream, and the simulation neither knows nor cares that it exists.

**Restoration is not gated by the mode.** `enhanced` gates what the port *adds* -
camera shake, chromatic aberration, the shockwave. Anything the original drew
and the port had been leaving out is on in both modes, because putting it back
makes faithful mode more faithful, not less. That covers the `fx/*` impact clips
and the whole pre-launch scene.

**The outcome clip is drawn where the shot came down.** `createHitClip` takes
`bc._x`/`bc._y` (Game.as:862-875, 964-967) - which is why `deleteBlt()` had to
leave the projectile alive. The port reported the hamster back at (148, 956)
for the whole `settling` phase, so the cheer, the faceplant and the crater all
played at the launcher, normally far off the left edge. `settling` carries the
landing position now; `onDone()` is what returns the hamster to the pad, and it
does not run until the camera has panned home (Game.as:971-981). The
faceplant's `+ 3` y offset is a display rule and lives in
`src/render/scene/pose.ts`, next to the no-rotate one, and the shadow is hidden
for every outcome as `blt.shadClip._visible = false` does.

**A missed jump costs no turn.** `jumpFrame()` ends a jump that comes back down
with `faceplant = true`, `shooting = true` and a zero (Game.as:1090-1096). With
the hitboxes extracted from the shape records, about a third of the rolls cannot
reach the launch window at all - see the reachability figure above - so the port
returns to `ready` with the turn intact and lets the player jump again. Only a
pillow hit ends a turn, and `ShotOutcome 'zero'` is therefore unreachable at run
time. The original's one-swing-per-jump rule (`state = "launch"`, Game.as:1029-1037)
is reproduced, which is what keeps the retry from being solved by mashing.

**No clip is indexed off a free-running clock.** That used to be the default -
one `animFrame(meta, elapsed)` for everything - and it was wrong for every clip
the original does not loop:

- The hamster's own clip is held on frame 1 until the click (`reset()`,
  Game.as:365-366), started with `gotoAndPlay("jump")` on the first
  `onMouseDown`, and each outcome clip is attached fresh when the shot ends.
  `src/render/PoseClock.ts` reproduces that with one anchor per *run* - the
  pose together with the phase it is shown in. Per pose was not enough:
  `ready` and `jumping` are the same clip, so the anchor was never dropped at
  the click and the jump started wherever a clock anchored at boot had got to.
  See the next entry for where the run ends.
- The powerup clips are attached and left standing, and `_loc3_.play()` at the
  moment of pickup runs the rest (Game.as:701, 716, 727, 750, 768). Only the
  first two frames are the collectible: `powerup/bounce`, `powerup/slide` and
  `powerup/superbounce` are two frames of item, four of burst and twenty
  blank; `powerup/speed` is two, four and two; `powerup/rebound` is a board
  that flattens and springs back over its remaining seven. Running them made
  every collectible blink out for most of a 1.4 s cycle. They are pinned to
  frame 0 now (`POWERUP_IDLE_FRAME`), and the burst is played from the
  `pickup` cue instead: `Effects` gives it the same short lifetime the `fx/*`
  impacts have, resuming the collectible's own clip at frame 2 rather than
  attaching a new one. It has to live in the renderer because the simulation
  culls a taken item within a tick (`Tuning.powerupActiveTicks`), and that
  number is load-bearing for the physics goldens. `wind` gets no burst: its
  branch plays the hamster's own wind clip and never touches the collectible
  (Game.as:733-746).

What is left looping is genuinely looping and event-gated: the launcher wheels
turn only while the hamster is jumping (`PreLaunchScene`), and the `fx/*`
impacts run once from their cue and are pruned (`Effects`).

**The jump clip was authored for a clip nobody moves.** Char 52 is one timeline
of four runs: five identical frames of the hamster standing (frame 1, what
`gotoAndStop(1)` holds), seven of it pulling the goggles down, seven holding
that pose - then a crouch, a five-frame takeoff, a tumbling ball and one blank
frame. Two things in it only make sense for a clip that stays put:

- the takeoff lifts the art ~100 px out of its own box while the shadow stays
  at the bottom, and
- the shadow is *in the art* - the ellipse under the feet, the bottom 6 px of
  every standing frame. There is no `shadow` sprite in the manifest at all;
  `Bullet`'s `shadClip` was never exported, so the flight casts none.

`jumpFrame()` does move the clip (`hamster._y += yvel`, Game.as:1082). Playing
the takeoff on top of that drew the hamster a hundred px above the `core` that
tests against the pillow and then snapped it back, and the blank frame blinked
it out mid-jump; the standing frames carried their painted-on shadow up into
the sky with it. So the port bounds the run at the held goggles pose
(`JUMP_RUN_LAST`, the frame the original itself repeats seven times) and drops
the shadow strip for the length of the jump (`bottomCrop`, `JUMP_SHADOW_STRIP`
- both renderers leave that much off the bottom of the frame). Two display
rules, next to the faceplant's `+ 3` and the no-rotate one. Where the `"jump"`
label and the clip's `stop()` actually sit is not recoverable from the exported
art - only the frame scripts would say - but which frames may be drawn while
the code owns the position is, and that is what these bound.

**Every outcome clip is turned a quarter, whatever the shot did.**
`createHitClip(x, y, rot, type)` takes a rotation and ignores it:
`hitClip._rotation = 90` unconditionally (Game.as:1006-1013). That is not a
flourish, it is how the `hit_*` symbols are drawn - on their side, ground line
down the right edge of the art, which the export shows plainly: `hit/cheer`
ends on a distance post lying flat and `hit/hole` is a crater with its sign
hanging sideways. The port had read the flight convention (art facing right,
`_rotation = atan2 + 90` from `Bullet.update`) as applying to these too and
drew them unrotated, which stood the hamster on its nose against a vertical
ground line. `hamsterRotation` returns the quarter turn for `settling` now.

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

## Fixed against the bytecode, later

A review against `Game.as` found four places where the port had drifted from
the source it cites. Each has a test in `test/sim/` that fails on the old code.

- **Rebound clears the skid.** `checkPowerUpsColl`'s rebound branch
  (Game.as:757-766) drops `skidding`, `falling` and - only if the hamster was
  skidding - `slide`. The port set `rebound` alone, so a rebound out of a skid
  left `skidding` set and `onMouseDown`'s `!skidding` test blocked glide for
  the rest of the shot.
- **`sndPickup` is not for every pickup.** Only bounce, superbounce and slide
  play it (Game.as:700, 715, 749). `PowerupSpec.sound` carries that.
- **The slide/skid sound branch.** Game.as:556-592 is a three-way branch: the
  slide loop starts once and then tracks `|xvel|`, the skid cue plays once and
  ducks the flight loop to 5, otherwise the flight loop's gain follows the
  speed every tick. The port had two identical `doRotation = false` arms and
  never emitted `slide`; `flyGain`/`slideGain` had no callers. A `sfxGain`
  event carries the volumes now, and `shoot()`'s `sndPrelude.stop()` is
  emitted on launch.
- **`falling = false` is an event.** Every arm of `checkCollision` ends with
  it, and the arming pickups do it too. The port emitted the `glide` off-cue
  two lines earlier and swallowed this one.

Two things that were half-present are now whole:

- **The camera pans home.** After a shot the outcome clip plays
  (`Tuning.outcomeHoldTicks`), then its last frame calls `setCamReset()` and
  `GameCamera.doQuickPanTo` converges on (300, 800); `onDone()` advances the
  turn on arrival. `settling` has the two stages, `quickPanStep` has a caller,
  and `camera.maxPanTicks` is the soft-lock cap it was described as.
- **The no-rotate rule.** `Bullet.update` (Bullet.as:46) stops turning the
  clip below y = 940 while `xvel < 7` - the signed value, as written. It is a
  display rule, so it lives in `src/render/scene/pose.ts`, applied by both
  renderers.

And two ordering details in the port itself: commands are applied in the order
given, so `[press, togglePause]` no longer drops the press; and the shot driver
in `src/sim/drive.ts` is the single one behind the golden tests and the bench,
which used to disagree on their tick budgets.

## Presentation departures, recorded

- **Interpolation between ticks.** The original stage ran at 19 fps with no
  tweening. This port places the hamster and the camera between the last two
  ticks on every frame, in both modes, for consecutive ticks of the same phase
  only. Simulation and scores are untouched; `src/render/interpolate.ts`.
- **Impact clips at world x.** The original pins `bounce_fx` to screen x 155
  and the two breaks to 165 (Game.as:812, 831, 853). The port places them at
  the hamster's world x, which is the same point while the camera follows at
  its 150 px anchor and differs only left of x = 150.
- **The exactly-70-degree branch.** `checkCollision`'s final `else` is reached
  only when the impact angle is exactly 70.000 degrees. It is transcribed but
  practically unreachable, and untested for that reason.
