import type { SpriteId } from "@/assets/sprites.generated.ts";
import { FONTS } from "@/render/scene/hud.ts";
import { C } from "@/sim/constants.ts";

/**
 * What the page draws over the original's picture: flags on the ground where
 * the player's record and the ghost's shot came down, and the ghost itself.
 * None of it is in the snapshot - the simulation knows nothing of records or
 * ghosts - so it reaches the renderers alongside it. Geometry lives here, as
 * `hud.ts` holds the HUD's, so both backends put it in the same place.
 */

export type FlagKind = "record" | "ghost";

export interface FlagMarker {
  readonly kind: FlagKind;
  /** World pixels. */
  readonly x: number;
  readonly label: string;
}

/** Where the ghost is this frame: a pose of the hamster clip, drawn translucent. */
export interface GhostPose {
  readonly x: number;
  readonly y: number;
  readonly rotationDeg: number;
  readonly pose: SpriteId;
}

export interface Overlay {
  readonly flags: readonly FlagMarker[];
  readonly ghost: GhostPose | null;
}

export const NO_OVERLAY: Overlay = { flags: [], ghost: null };

export const FLAG = {
  poleW: 2,
  poleH: 36,
  clothW: 18,
  clothH: 11,
  /** Label baseline above the ground, right of the pole. */
  labelDx: 5,
  labelDy: 40,
  font: `700 10px ${FONTS.ui}`,
  fontSize: 10,
  colour: { record: 0xffd166, ghost: 0xc9a7ff } satisfies Record<FlagKind, number>,
  ink: "#ffffff",
  stroke: "#0c141e",
} as const;

/** Faint enough to read as a ghost, solid enough to race against. */
export const GHOST_ALPHA = 0.42;

/** The flags inside the view with room for a label, left to right. */
export function visibleFlags(flags: readonly FlagMarker[], cameraX: number): FlagMarker[] {
  const left = -cameraX - FLAG.clothW;
  const right = -cameraX + C.VIEW_W + 80;
  return flags.filter((f) => f.x >= left && f.x <= right).sort((a, b) => a.x - b.x);
}

/** The pole's top-left and the cloth's three corners, in world pixels. */
export function flagGeometry(x: number): {
  readonly pole: readonly [number, number, number, number];
  readonly cloth: readonly [number, number, number, number, number, number];
} {
  const top = C.GROUND_Y - FLAG.poleH;
  return {
    pole: [x - FLAG.poleW / 2, top, FLAG.poleW, FLAG.poleH],
    cloth: [
      x + FLAG.poleW / 2,
      top,
      x + FLAG.poleW / 2 + FLAG.clothW,
      top + FLAG.clothH / 2,
      x + FLAG.poleW / 2,
      top + FLAG.clothH,
    ],
  };
}

/** Two flags closer than a label's width stack their labels instead of overprinting. */
export function labelOffsets(flags: readonly FlagMarker[]): number[] {
  const out: number[] = [];
  let lastX = Number.NEGATIVE_INFINITY;
  let lift = 0;
  for (const flag of flags) {
    lift = flag.x - lastX < 110 ? lift + 12 : 0;
    out.push(lift);
    lastX = flag.x;
  }
  return out;
}
