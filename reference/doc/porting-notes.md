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

`sim.js` used 40 px on both axes. The flight core's extents are clip-local,
though, and the clip turns: `Bullet.update()` writes
`_rotation = radToDeg(atan2(yvel, xvel)) + 90` every tick (`0 + 90` with
rotation off, so never 0), and `core.hitTest(this.bc.core)` compares
stage-space bounds, which include the parent's rotation. In level flight
(about 90) the core lies on its side: against an 8 px powerup `node` the x
window is `32.50 + 8.0 = 40.5` and the y window `19.90 + 8.0 = 27.9`. Only a
hamster flying straight up or down gets the upright `27.9 x 40.5`. So
`sim.js`'s 40 px was about right in x and about 1.4x too generous in y.

`rotateBox` in `src/sim/math/aabb.ts` computes the stage-space box - the centre
offset turns with the clip, the half-extents mix as `|cos| hw + |sin| hh` and
`|sin| hw + |cos| hh` - and `Projectile.rotationDeg` carries `_rotation` with
the original's rule, taken before the move. The pickup test runs before
`update()` in the tick (Game.as:504 vs :630), so it sees the previous tick's
value, and on the first flight tick `setClipPos()`'s `_rotation = this.ang`
(Bullet.as:79) - the launch angle in radians, written into a degrees property.

**Interpretation, not verified against a player.** This follows from the
bytecode and from `hitTest(clip)`'s documented stage-space semantics; it has
not been checked in Ruffle or a Flash player. One gap in the evidence:
`extract_hitboxes.py` discards the rotate/skew terms of the `core` placement
inside sprite 331. The tall box is consistent with art authored pointing up,
but only the SWF can confirm `core` is not itself placed turned.

### Two consequences worth knowing

**The launch window is y in [694.7, 776.4].** It follows from the jump-phase
`core` (half-extent 13.73, centre offset +1.07/+5.32) against the whole pillow
clip at (140, 740.9).

**Every jump can reach it.** For a long time this said the opposite: 68% of
rolls, the rest unavoidable faceplants, an apex between 660 and 840. That came
from starting the physics on the pad. Nothing in `Game.as` calls `jump()` -
`onMouseDown` only does `hamster.gotoAndPlay("jump")`. Clip 52 calls it, from
its frame 28 script, after playing a 26-frame wind-up in place, and the line
before the call is `this._y -= 117.8` (`as2/timeline/DefineSprite_52/frame_28`).
From y = 838.2 the one-shot boost fires on the first tick, the apex spans 492 to
642, and all 1000 measured seeds pass through the window on the way up and on
the way down. `test/golden/reachability.spec.ts` pins that. The `core` is placed
on frame 28 and no other (`display-lists.txt`, sprite 52), which settles the
old worry that it might move during the animation - and means a swing during
the wind-up has nothing to hit.

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

The original sets `_rotation = radToDeg(atan2(yvel, xvel)) + 90` on the arrow
clip (331), which is authored pointing up. The poses inside it are *not* all
authored the same way round, and for a long time the port assumed they were:
it subtracted the `+ 90` from every pose, which is right for `flying_mc` alone.
Sprite 331's own display list (`as2/timeline/display-lists.txt`) says how each
one is placed: `flying_mc` and `drop` are drawn facing right and placed with
`[0, -1, 1, 0]`, a quarter turn back to pointing up; `glide` at 0.9 scale; and
`wind`, `blur`, `slide`, `skid` and `ball` as they are. `build_sprites.py`
dropped all but the translation of that matrix. It now writes the whole
placement into the manifest, the renderers apply it inside the clip's
rotation, and the rotation is the sim's `rotationDeg` unmodified. The visible
casualty was the ground: rotation is pinned at 90 while skidding, and the
skid and skateboard poses stood the hamster next to a board on its end instead
of lying it on top. `blur`, `wind` and `glide` were a quarter turn off in the
air too.

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
| `speed` and `wind` have no re-entry guard; `bounce`, `slide`, `superbounce`, `rebound` do | **Reproduced.** How long each keeps firing comes from its clip: `play()` sends every pickup clip to frame 2, which removes its `core`, so speed fires for about one tick - but `_wind` is never `play()`ed and never loses its core, so wind blows for as long as the boxes overlap. That used to be a guessed 3 ticks. |
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
`src/render/scene/pose.ts`, and the shadow is hidden
for every outcome as `blt.shadClip._visible = false` does.

**A missed jump costs no turn.** `jumpFrame()` ends a jump that comes back down
with `faceplant = true`, `shooting = true` and a zero (Game.as:1090-1096). The
port returns to `ready` with the turn intact and lets the player jump again.
This began as a repair - with the physics wrongly starting on the pad, a third
of the rolls could not reach the pillow - and stays as a deliberate leniency
now that every roll can: a mistimed click, or one spent during the wind-up,
puts the hamster back on the pad. Only a pillow hit ends a turn, and
`ShotOutcome 'zero'` is therefore unreachable at run time. The original's
one-swing-per-jump rule (`state = "launch"`, Game.as:1029-1037) is reproduced,
which is what keeps the retry from being solved by mashing.

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

**The jump clip moves itself, once.** Char 52's frame scripts
(`as2/timeline/DefineSprite_52`) say how it is played: label `jump` on frame 2;
frames 2-27 on the pad - goggles down, crouch, and a leap that lifts the art
115 px inside the clip; `snd_jump` on frame 23; and on frame 28
`this._y -= 117.8; hamsterShoot.jump(); stop()`. The clip jumps up to where the
art already is and draws the tumbling ball - nested clip 51, which loops four
frames on its own - back on its registration point, so the hand-over to
`jumpFrame()` is seamless. Frames 29-36 are never shown.

The port used to read the takeoff frames as art authored "for a clip nobody
moves", start the physics on the pad at the click, hold the goggles frame for
the whole jump and crop the painted-on pad shadow off the bottom. All of that
is gone. The simulation plays the wind-up (`JumpState.windup`,
`JUMP_WINDUP_FRAMES`, 28 ticks) and performs the lift; `PoseClock` draws the
wind-up frame for the simulation's tick, so art and lift cannot drift apart,
then loops the ball; interpolation cuts at the lift instead of smearing it; and
the drop shadow stays off while the clip's own ellipse is on the pad.

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

### Clip positions live on the twip grid

AVM1 stores `_x`/`_y` as whole twips (1/20 px), so every write to a clip
property is quantised. The original keeps four things as clip properties: the
hamster's position (`bc._x`/`_y`, Bullet.as:51-52), `ox`/`oy` (read back from
the clip, Bullet.as:42-43), the camera container (`_$mc._x`/`_y`,
GameCamera.as:68-79, 184-187) and the powerup positions (Game.as:1325-1332).
Velocities are plain `Number`s and are not affected. The port quantises at
exactly those writes with `toTwips` (`src/sim/math/twips.ts`): in
`Projectile.integrate()`, `follow`, `quickPanStep`, `spawnPowerups` and the
jump. The quick pan keeps the original's split - `cameraTargetX/Y` are
unquantised accumulators and only the container copy is rounded - so
`settling` carries a `pan` accumulator next to `camera`. The ground writes
(`950`, `949`) are whole pixels already.

The error adds up tick by tick, so it matters near the boundaries: the
`Math.floor(x / 100)` feet boundary, the exactly-70 degree angle test, the
`>= 946` skid test and the `600 - camX` spawn gate.

**The rounding mode is an assumption.** Nearest twip (`Math.round`) is used;
nothing has been checked against a Flash player. Truncation toward zero -
what Ruffle's `Twips::from_pixels` may do - was tried: it biases every
position toward zero by up to a twip per write, and that flips two relations
in `test/golden/strategies.spec.ts` that were already on a knife edge (the
`hold` and `mash` peak medians sit on the same ~226k px plateau, 0.3% apart,
and the long-tail check cleared `2 x median` by 4 ft). Nearest rounding leaves
every golden where it was. A player trace would settle it; the rounding is one
line in `toTwips`.

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
- **Music cues on restart, turn advance and game over.** `reset()` replays
  `sndPrelude` and stops `sndTheme` (Game.as:338-339); `nextHamster()` fades
  the theme out (Game.as:990); `gameOver()` stops the prelude and fades the
  theme before the ending plays (Game.as:416-418). The port emitted none of
  these, so the theme would have run forever after the first launch and the
  prelude would not have come back after a restart. `sfxStop` carries
  `fade: true` where the original calls `fadeOutSound`. `sndEnding` is not
  stopped on restart: `reset()` itself never touches it, only `resetBtn()`'s
  `stopAllSounds()` (Game.as:326) does - and the timeline settles which one
  the game over offers. PLAY AGAIN is button 257, placed on `gameOver_mc`'s
  frame 60, and it calls `reset()`. Button 505, the one wired to
  `resetBtn()`, is a debug "reset" placed off the bottom of the stage at
  (567.55, 413), where no player can click it.
- **`falling = false` is an event.** Every arm of `checkCollision` ends with
  it, and the arming pickups do it too. The port emitted the `glide` off-cue
  two lines earlier and swallowed this one.

Two things that were half-present are now whole:

- **The camera pans home.** After a shot the outcome clip plays, then a
  frame script calls `setCamReset()` and `GameCamera.doQuickPanTo` converges
  on (300, 800); `onDone()` advances the turn on arrival. `settling` has the
  two stages, `quickPanStep` has a caller, and `camera.maxPanTicks` is the
  soft-lock cap it was described as. How long the clip plays was a guess in
  `Tuning.outcomeHoldTicks` (24 ticks for a cheer, 20 for a faceplant) until
  the frame scripts turned up: `hit_cheer` and `hit_hole` call `setCamReset()`
  on frame 50, 52 ticks; `hit_faceplant` never does - its frame 20 attaches a
  `hit_cheer` in its place, so a faceplant is 20 ticks of faceplant and then
  the whole cheer; `hit_zero` does the same on frame 36 after moving itself to
  x = 220. Those are constants now (`OUTCOME_CAM_RESET_FRAME`,
  `FACEPLANT_CHEER_FRAME`, `ZERO_CHEER_FRAME`) and `settling.clip` says which
  clip is showing. Still not reproduced: the cheer's frame 9 `setScore()` and
  frame 27 distance caption - the port's HUD records the shot when it lands.
- **The no-rotate rule.** `Bullet.update` (Bullet.as:46) stops turning the
  clip below y = 940 while `xvel < 7` - the signed value, as written, and
  tested on the pre-move y. It first lived in `src/render/scene/pose.ts` as a
  display rule; since the pickup box turns with the clip it is physics, and
  `Projectile.integrate()` applies it. The renderers read `rotationDeg` back.

And two ordering details in the port itself: commands are applied in the order
given, so `[press, togglePause]` no longer drops the press; and the shot driver
in `src/sim/drive.ts` is the single one behind the golden tests and the bench,
which used to disagree on their tick budgets.

## Sound

There was none. The simulation had emitted its cues all along - `sfx`,
`sfxStop`, `sfxGain` - and nothing consumed them; no MP3 had been extracted.

- **The files** come straight out of the DefineSound tags
  (`tools/build_sounds.py`): every sound in this SWF is MP3, so the tag body
  after its SeekSamples is a playable file, byte-identical to ffdec's export.
  SeekSamples - the encoder latency, 1670-1695 samples, about 76 ms at
  22 kHz - and the sample count go into `sounds.generated.ts`, and the player
  plays and loops each sound on that extent rather than on the decoder's
  padding, which is what Flash did.
- **The player** (`src/audio/AudioPlayer.ts`) follows `Sound` semantics: one
  object per id, `setVolume` for all its instances, `start()` adding one,
  `stop()` stopping all, `fadeOutSound` as a single 50 ms interval taking 3
  off, which a second fade abandons half-way, as the original's shared
  `sndFadeInterval` does. Volumes above 100 - `flyGain` reaches them at speed
  - are clamped, since Flash documents 0-100 and the port will not guess at
  amplification.
- **`jump` is `snd_jump`**, not `snd_hit`: clip 52 plays it on frame 23 of the
  wind-up, and `hit_cheer` again on frame 27 as the distance caption appears.
- **Timeline sounds.** Seven more sounds are started by `StartSound` tags on
  clip frames, never by `Game`: the tumbling ball (clip 51, every pass of its
  four-frame loop), the launcher wheel's squeak (twice, from its `LoopCount`),
  the pillow's thump into the frame on a whiff (`background_mc` frame 22,
  reusing `snd_bump`), the cheer and the caption tick, the hole and its
  fanfare, the rebound and speed pickups, and the game-over fanfare with
  PLAY AGAIN on `gameOver_mc` frame 60. The simulation emits them with
  `delayFrames` - stage frames after the tick that attached the clip - and
  their envelope levels as gains; out points and the speed pickup's fade-out
  envelope are in the player. So speed and rebound do have a sound; `Game`
  just never plays one for them.
- **Unlocking.** Browsers only start audio from a gesture. Until then the
  player remembers which loops ought to be playing - the prelude, from
  `init()`'s first step - and starts them once the first press has created
  the context and the files have loaded.
- **The music button** is `toggleMusic()`: music only, back at 60 rather than
  80 when unmuted, not remembered (`initSO` stores scores only). `M` is its
  key.
- **Not reproduced:** the title music (sound 484, root frame 5) - there is no
  title screen - and panning: envelope levels are averaged over the two
  channels.

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
