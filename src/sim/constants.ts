/**
 * Every value here was read out of the original AVM1 bytecode, not estimated.
 * Line references are to `reference/as2/Game.as` and `reference/as2/Bullet.as`.
 *
 * This module is frozen on purpose: changing a number here is a fidelity bug,
 * not a tuning decision. Values that are genuinely unknown live in `tuning.ts`.
 */
export const C = Object.freeze({
  /** `setInterval(this, "onUpdate", 50)` - 20 Hz. Game.as:1071, 1182. */
  TICK_MS: 50,

  // -- flight physics ------------------------------------------------------
  /** Bullet constructed with gravity 0.99. Game.as:1176, Bullet.as:64. */
  GRAV: 0.99,
  /** `blt.xvel *= 0.99` every tick, always. Game.as:603. */
  DRAG: 0.99,
  /** `f` - horizontal restitution on bounce. Game.as:93. */
  BOUNCE_F: 0.6,
  /** `slidef` - horizontal restitution while sliding. Game.as:94. */
  SLIDE_F: 0.99,
  /** Plain bounce: `yvel /= -2`. Game.as:808. */
  PLAIN_BOUNCE_Y_DIV: -2,
  /** bounce powerup: `yvel *= -0.6`, floored at -30. Game.as:822-826. */
  BOUNCE_Y_MUL: -0.6,
  BOUNCE_Y_MIN: -30,
  /** superbounce: `xvel *= 1 + f`, `yvel *= -1.5`, floored at -50. Game.as:840-844. */
  SUPERBOUNCE_Y_MUL: -1.5,
  SUPERBOUNCE_Y_MIN: -50,

  // -- glide --------------------------------------------------------------
  /**
   * `Bullet.increaseGravity` ignores its argument and always computes
   * `-0.17 * xvel`: lift proportional to horizontal speed. Bullet.as:58-61.
   */
  GLIDE_FACTOR: -0.17,
  GLIDE_MAX: 100,
  GLIDE_DRAIN: 10,
  GLIDE_REGEN: 1,

  // -- thresholds ---------------------------------------------------------
  /** Impact angle above this is a faceplant instead of a bounce. Game.as:803. */
  FACEPLANT_ANGLE_DEG: 70,
  /** `yvel > 50` switches to the falling/drop state. Game.as:608. */
  FALLING_YVEL: 50,
  GROUND_Y: 950,
  /** Bounces reset to 949, faceplants and slides stay at 950. */
  BOUNCE_RESET_Y: 949,
  /** Two consecutive ticks at or below this start the skid. Game.as:625. */
  SKID_Y: 946,
  /**
   * Below this y and under 7 px/tick of xvel the clip stops rotating.
   * Bullet.as:46. Not display only: the rotated clip is what the pickup test
   * measures, so it is applied in `Projectile.integrate()`.
   */
  NO_ROTATE_Y: 940,
  NO_ROTATE_XVEL: 7,

  // -- shadow ------------------------------------------------------------
  /** `shadClip._y = 963` and `_xscale = _yscale = 100 * (y - 700) / 263`. Bullet.as:54-56. */
  SHADOW_Y: 963,
  SHADOW_REF_Y: 700,
  SHADOW_DIV: 263,

  // -- world / launch geometry -------------------------------------------
  HAMSTER_X: 148,
  HAMSTER_START_Y: 956,
  /**
   * Where `game_mc.pillow` sits until `launch()` moves it. The port no longer
   * draws that clip - the pillow you see is the one in the launcher's own art -
   * so this is kept as the measured value and read by nothing.
   */
  PILLOW_REST_X: 117.3,
  /** `launch()` moves the pillow before testing. Game.as:1120. */
  PILLOW_LAUNCH_X: 140,
  PILLOW_Y: 740.9,
  /** `getPillowCollision` clamps y and zeroes yvel above this. Game.as:1126-1130. */
  PILLOW_CLAMP_Y: 759,
  /** `dx = hamster._x - pillow._x + 30`. Game.as:1133. */
  LAUNCH_DX_BIAS: 30,
  /** `dy = hamster._y - pillow._y - 5`. Game.as:1134. */
  LAUNCH_DY_BIAS: -5,
  /** `vel = 90 - dist` - speed is nearness to the pillow centre. Game.as:1157. */
  LAUNCH_VEL_BASE: 90,

  // -- jump phase --------------------------------------------------------
  /**
   * The stage rate. `Game` runs on 50 ms intervals, but every clip timeline -
   * and so everything a frame script triggers - runs on the SWF's 19 fps.
   */
  STAGE_FPS: 19,
  /**
   * `onMouseDown` only does `hamster.gotoAndPlay("jump")` (Game.as:1024);
   * nothing in Game.as calls `jump()`. Clip 52 does, from its frame 28 script
   * (as2/timeline/DefineSprite_52/frame_28), after playing its wind-up in place:
   * goggles down, crouch, leap. Label `jump` is frame 2, so that is 26 frames
   * on the pad - and no `core`, which the clip only places on frame 28
   * (display-lists.txt, sprite 52), so a swing during the wind-up cannot hit.
   */
  JUMP_WINDUP_FRAMES: 26,
  /** `sndJump.attachSound("snd_jump"); sndJump.start()` - clip 52, frame 23. */
  JUMP_SFX_FRAMES: 21,
  /**
   * `this._y -= 117.8` right before `jump()` - clip 52, frame 28. The wind-up
   * lifts the art 115 px inside the clip; this moves the clip up to where the
   * art already is and draws the tumbling ball back on the registration point,
   * so the physics starts from y = 838.2, not from the pad.
   */
  JUMP_CLIP_LIFT: 117.8,
  /** `yvel = (random(5) + 10) * -1`. Game.as:1066. */
  JUMP_YVEL_BASE: 10,
  JUMP_YVEL_RAND: 5,
  /** One-shot boost `random(5) + 15` below y = 930. Game.as:1076-1081. */
  JUMP_BOOST_BASE: 15,
  JUMP_BOOST_RAND: 5,
  JUMP_BOOST_Y: 930,
  /** Asymmetric gravity: 1.5 rising, 0.75 falling. Game.as:1083. */
  JUMP_GRAV_RISING: 1.5,
  JUMP_GRAV_FALLING: 0.75,

  // -- timeline sounds ----------------------------------------------------
  // Levels are the `StartSound` envelope's, averaged over the two channels
  // (level / 32768 * 100); the port does not pan.
  /** Clip 51 frame 1, envelope 6199/5904 - the tumbling ball, every 4 frames. */
  TUMBLE_VOLUME: 18,
  /** Clip 51 loops frames 1-4 (`gotoAndPlay(1)` on frame 4). */
  TUMBLE_FRAMES: 4,
  /** `background_mc` frame 22, `snd_bump` at 18303/12399 - 12 frames into "miss". */
  SWING_MISS_BUMP_FRAMES: 12,
  SWING_MISS_BUMP_VOLUME: 47,
  /** `hit_cheer` frame 5, envelope 25093/26864. */
  CHEER_VOLUME: 79,
  CHEER_SFX_FRAME: 5,
  /** `hit_cheer` frame 27 plays `snd_jump` as the distance caption goes up. */
  CHEER_CAPTION_FRAME: 27,
  /** `hit_hole`: its sound on frame 1, the fanfare on frame 28. */
  HOLE_FANFARE_FRAME: 28,
  /** `_speed` frame 2, from `play()` at frame 1 (Game.as:729). */
  SPEED_SFX_FRAME: 2,
  /** `_rebound` frame 4, from `play()` at frame 1. */
  REBOUND_SFX_FRAME: 4,
  /** `gameOver_mc.gotoAndPlay(2)`; frame 60 places PLAY AGAIN and the fanfare. */
  GAME_OVER_PLAY_AGAIN_FRAME: 60,

  // -- outcome clips ------------------------------------------------------
  /**
   * `hit_cheer` and `hit_hole` call `_root.hamsterShoot.setCamReset()` from
   * their frame 50 script (as2/timeline/DefineSprite_351_hit_cheer/frame_50,
   * DefineSprite_365_hit_hole/frame_50) - the quick pan home starts there.
   */
  OUTCOME_CAM_RESET_FRAME: 50,
  /**
   * `hit_faceplant` does not reset the camera: its frame 20 script calls
   * `createHitClip(this._x, this._y, this._rotation, "cheer")`, which attaches
   * a cheer at the same depth, replacing it - so a faceplant is followed by
   * the whole cheer clip. DefineSprite_372_hit_faceplant/frame_20.
   */
  FACEPLANT_CHEER_FRAME: 20,
  /**
   * `hit_zero` does the same on frame 36, after `this._x = 220`, at its own
   * depth (the `dpth` argument), so the zero stays under the cheer.
   * DefineSprite_378_hit_zero/frame_36.
   */
  ZERO_CHEER_FRAME: 36,
  ZERO_CHEER_X: 220,

  // -- powerup effects ---------------------------------------------------
  SPEED_XVEL: 20,
  WIND_YVEL: -8,
  WIND_XVEL: 2,
  REBOUND_XVEL: 40,
  REBOUND_YVEL: -40,

  // -- powerup spawning --------------------------------------------------
  /** `if (600 - camX < powerupMark) return`. Game.as:1277. */
  SPAWN_GATE: 600,
  /** `powerupMark += 150` - one spawn per 150 px of camera travel. Game.as:1281. */
  SPAWN_EVERY_PX: 150,
  /** `x = 800 - camX` - 200 px right of the viewport. Game.as:1283. */
  SPAWN_AHEAD_X: 800,
  /** `init()` and `reset()` both start at 650. Game.as:147, 385. */
  POWERUP_MARK_INIT: 650,
  /**
   * ...but `cleanUpItems()` sets 600, not 650. Game.as:1389. Reproduced on
   * purpose: it shifts the first spawn of turns 2-5 by 50 px, which is
   * observable.
   */
  POWERUP_MARK_RESET: 600,
  /** `y = 840 - random(1200)` for airborne powerups. Game.as:1285. */
  POWERUP_Y_BASE: 840,
  POWERUP_Y_RAND: 1200,
  /** rebound is a ground item. Game.as:1285. */
  REBOUND_Y: 930,
  /** `random(11)` drives the type table. Game.as:1288. */
  POWERUP_ROLL: 11,
  /** Culled once the clip is 100 px left of the viewport. Game.as:680. */
  POWERUP_CULL_X: -100,

  // -- camera ------------------------------------------------------------
  /** `_$mc._x = -targetX + 150`, `_y = -targetY + 200`. GameCamera.as:60-61. */
  CAM_ANCHOR_X: 150,
  CAM_ANCHOR_Y: 200,
  /** `zero()` parks the camera here, and `doFollow` clamps y to it. */
  CAM_Y_CLAMP: -600,
  /** `new GameCamera(this._$mc, 600, 400)`. Game.as:108. */
  VIEW_W: 600,
  VIEW_H: 400,
  /** `reset()` sets `qpan_time = 2`. GameCamera.as:36. */
  CAM_QPAN_TIME: 2,
  /** `doQuickPanTo` finishes once the remaining distance drops under 2. */
  CAM_PAN_ARRIVE: 2,
  /** `reset()` pans back to this point. GameCamera.as:37. */
  CAM_RESET_TARGET_X: 300,
  CAM_RESET_TARGET_Y: 800,

  // -- scoring / session -------------------------------------------------
  /** `Math.floor(bltClip._x / 100)` - 100 px is one foot. */
  PX_PER_FOOT: 100,
  TURNS: 5,
  /** `turn == 6` ends the game. */
  GAME_OVER_TURN: 6,

  // -- audio -------------------------------------------------------------
  MUSIC_VOL: 80,
  SFX_VOLUME: 100,

  /** Reachable with enough speed powerups. Doc section 5. */
  SPACE_BG_Y: -4790,
} as const);

// Not ported, deliberately:
//   `glideVals` (Game.as:145) - 25 hand-tuned values, written once and never
//   read. Dead code from an earlier glide implementation.
