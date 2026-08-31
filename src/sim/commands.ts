/**
 * Input reaches the simulation as discrete commands, never as a sampled
 * "is the button held" boolean.
 *
 * That is not a style preference. `Bullet.increaseGravity()` is called once,
 * from `onMouseDown` (Game.as:1040), and freezes the glide lift at the xvel
 * measured at that instant. A sampled boolean cannot express the difference
 * between "pressed this tick" and "still holding", so it cannot reproduce the
 * original's behaviour at all.
 */
export type InputCommand =
  /** Pointer went down: starts the jump, hits the pillow, or engages glide. */
  | { readonly kind: 'press' }
  /** Pointer released: disengages glide. */
  | { readonly kind: 'release' }
  /** Advance past an outcome or menu screen. */
  | { readonly kind: 'confirm' }
  | { readonly kind: 'togglePause' };
