#!/usr/bin/env python3
"""Give the atlas's ink lines one even weight.

The sprites come from Flash vector art whose outlines are brush strokes: a
line runs from a hairline to four or five pixels and back within one hamster.
This reads the 2x sheet, finds the dark ink, and redraws every stroke of
outline weight at one width - the centre line of each stroke is kept, only its
thickness changes - then takes the 1x frames from the result by an exact 2:1
box filter, since both sheets share one layout.

    python3 scripts/normalize-outlines.py src/assets/sprites          # both sheets
    python3 scripts/normalize-outlines.py src/assets/sprites --crop 1135 1183 50 71 --out /tmp/x.png

Needs Pillow, numpy, scipy and scikit-image. 
What it leaves alone, on purpose:
  * hairlines (fur hatching, whiskers), which are meant to be fine;
  * solid ink (pupils, the goggle rims), which is filled area, not a line;
  * anything that is not dark: the gold ball, the pink balls, the sparks.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

# Widths are in pixels of the 2x sheet; the work itself is done on a copy of
# each frame enlarged by SCALE, so the stroke edges are measured to a fraction
# of a pixel and the redrawn ones are antialiased by averaging back down.
SCALE = 4
TARGET_WIDTH = 3.0  # the weight every outline is drawn at
HAIRLINE = 1.7  # strokes thinner than this are detail and keep their weight
BLEND_TO = 2.6  # ...and are blended up to the target by this width
SOLID_RADIUS = 3.2  # ink thicker than this (as a disc) is a filled area
INK_LUMA = 88  # darker than this counts as ink
FRINGE = 0.75  # how far past the ink the old antialiasing is wiped
INK = np.array([22.0, 15.0, 9.0], dtype=np.float32)
PAD = 4  # context around a frame, in 2x pixels; never written back


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def disc(radius: float) -> np.ndarray:
    r = int(np.ceil(radius))
    y, x = np.mgrid[-r : r + 1, -r : r + 1]
    return (x * x + y * y) <= radius * radius


def enlarge(rgba: np.ndarray, factor: int) -> np.ndarray:
    """Bicubic, on premultiplied channels so a transparent edge does not bleed dark."""
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    pre = np.concatenate([rgba[..., :3].astype(np.float32) * a, a * 255.0], axis=-1)
    h, w = rgba.shape[:2]
    channels = [
        np.asarray(Image.fromarray(pre[..., c], mode="F").resize((w * factor, h * factor), Image.BICUBIC))
        for c in range(4)
    ]
    big = np.stack(channels, axis=-1)
    big[..., :3] = np.clip(big[..., :3], 0, 255)
    big[..., 3] = np.clip(big[..., 3], 0, 255)
    alpha = big[..., 3:4] / 255.0
    big[..., :3] = np.where(alpha > 1e-3, big[..., :3] / np.maximum(alpha, 1e-3), 0.0)
    return big


def reduce(big: np.ndarray, factor: int) -> np.ndarray:
    """Box filter back down, premultiplied, to uint8 straight alpha."""
    h, w = big.shape[0] // factor, big.shape[1] // factor
    a = big[..., 3:4] / 255.0
    pre = np.concatenate([big[..., :3] * a, big[..., 3:4]], axis=-1)
    box = pre.reshape(h, factor, w, factor, 4).mean(axis=(1, 3))
    alpha = box[..., 3:4]
    rgb = np.where(alpha > 0.5, box[..., :3] / np.maximum(alpha / 255.0, 1e-6), 0.0)
    out = np.concatenate([rgb, alpha], axis=-1)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def smooth_along(values: np.ndarray, mask: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian-average `values` over the pixels of `mask` only."""
    num = ndi.gaussian_filter(np.where(mask, values, 0.0), sigma)
    den = ndi.gaussian_filter(mask.astype(np.float32), sigma)
    return np.where(mask & (den > 1e-4), num / np.maximum(den, 1e-4), values)


def redraw(big: np.ndarray) -> np.ndarray:
    """`big` is float RGBA, straight alpha, already enlarged. Returns the same."""
    rgb, alpha = big[..., :3], big[..., 3] / 255.0
    ink = (luma(rgb) < INK_LUMA) & (alpha > 0.5)
    if not ink.any():
        return big
    s = SCALE

    # Filled areas: ink that survives an opening by a disc is not a line.
    solid = ndi.binary_opening(ink, structure=disc(SOLID_RADIUS * s))
    solid = ndi.binary_dilation(solid, structure=disc(1.5 * s))
    lines = ink & ~solid

    # The centre line of every stroke, and how thick it was there. The
    # thickness is measured on a skeleton one pixel wide, so it jitters by a
    # pixel; smoothing it along the line stops that showing up as a wobble.
    skeleton = skeletonize(lines)
    thickness = 2.0 * ndi.distance_transform_edt(lines)
    thickness = smooth_along(thickness, skeleton, 1.5 * s)
    keep = smoothstep(HAIRLINE * s, BLEND_TO * s, thickness)
    width = thickness * (1.0 - keep) + TARGET_WIDTH * s * keep
    radius = np.where(skeleton, width / 2.0, 0.0)

    # Coverage of the redrawn strokes: distance to the nearest centre-line
    # pixel against that pixel's radius, with a soft edge one output pixel wide.
    dist, (iy, ix) = ndi.distance_transform_edt(~skeleton, return_indices=True)
    coverage = np.clip((radius[iy, ix] - dist) / s + 0.5, 0.0, 1.0)
    coverage[dist > 8 * s] = 0.0

    # Wipe the old lines - ink plus its antialiasing fringe - by copying colour
    # and alpha from the nearest clean pixel, then draw the new ones over them.
    reach = disc((FRINGE + 0.5) * s)
    wipe = ndi.binary_dilation(lines, structure=reach) & ~solid
    clean = ~ndi.binary_dilation(ink, structure=reach) | solid
    _, (cy, cx) = ndi.distance_transform_edt(~clean, return_indices=True)
    out = big.copy()
    out[wipe] = out[cy[wipe], cx[wipe]]

    a_old = out[..., 3] / 255.0
    a_new = a_old + coverage * (1.0 - a_old)
    weight = np.maximum(a_new, 1e-6)[..., None]
    out[..., :3] = (
        out[..., :3] * (a_old * (1.0 - coverage))[..., None] + INK * coverage[..., None]
    ) / weight
    out[..., 3] = a_new * 255.0
    return out


def normalize(rgba: np.ndarray) -> np.ndarray:
    """One frame plus its context, uint8 RGBA in and out, at the sheet's scale."""
    return reduce(redraw(enlarge(rgba, SCALE)), SCALE)


# Sprites whose dark lines are shading, not outline: the launcher and the spring
# boards are dark brown on brown or orange, and
# redrawing that as ink turned the grain into blobs.
SKIP = re.compile(r"^(launcher|hud|fx|shadow|powerup)/|^(shadow|pillow)$")

SPRITE = re.compile(r"'([\w/]+)': \{(.*?)\n  \},", re.DOTALL)


def frame_rects(manifest: Path) -> list[tuple[int, int, int, int]]:
    """Every distinct frame rectangle on the sheet, in 1x pixels: x, y, w, h."""
    rects: set[tuple[int, int, int, int]] = set()
    for name, body in SPRITE.findall(manifest.read_text()):
        if SKIP.search(name):
            continue
        w = int(re.search(r"\bw: (\d+)", body).group(1))
        h = int(re.search(r"\bh: (\d+)", body).group(1))
        for x, y in re.findall(r"\[(\d+), (\d+)\]", body):
            rects.add((int(x), int(y), w, h))
    return sorted(rects)


def process_sheet(data: np.ndarray, rects: list[tuple[int, int, int, int]]) -> np.ndarray:
    """Every frame redrawn in place; whatever is between the frames is left alone."""
    out = data.copy()
    height, width = data.shape[:2]
    for x, y, w, h in rects:
        x0, y0, x1, y1 = x * 2, y * 2, (x + w) * 2, (y + h) * 2
        cx0, cy0 = max(0, x0 - PAD), max(0, y0 - PAD)
        cx1, cy1 = min(width, x1 + PAD), min(height, y1 + PAD)
        done = normalize(data[cy0:cy1, cx0:cx1])
        out[y0:y1, x0:x1] = done[y0 - cy0 : y1 - cy0, x0 - cx0 : x1 - cx0]
    return out


def halve(rgba: np.ndarray) -> np.ndarray:
    """The 1x sheet from the 2x one: an exact 2:1 box filter, premultiplied."""
    h, w = rgba.shape[0] // 2 * 2, rgba.shape[1] // 2 * 2
    px = rgba[:h, :w].astype(np.float32)
    a = px[..., 3:4] / 255.0
    pre = np.concatenate([px[..., :3] * a, px[..., 3:4]], axis=-1)
    box = pre.reshape(h // 2, 2, w // 2, 2, 4).mean(axis=(1, 3))
    alpha = box[..., 3:4]
    rgb = np.where(alpha > 0, box[..., :3] / np.maximum(alpha / 255.0, 1e-6), 0.0)
    out = np.concatenate([rgb, alpha], axis=-1)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("directory", type=Path, help="src/assets/sprites")
    parser.add_argument("--crop", nargs=4, type=int, metavar=("X", "Y", "W", "H"),
                        help="1x rectangle to process and write to --out, instead of the sheets")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    sheet2 = args.directory / "sheet-0@2x.png"
    image = Image.open(sheet2).convert("RGBA")
    data = np.array(image)

    if args.crop:
        x, y, w, h = args.crop
        pad = 6
        box = data[y * 2 - pad : (y + h) * 2 + pad, x * 2 - pad : (x + w) * 2 + pad]
        after = normalize(box)
        zoom = 6
        both = np.concatenate([box, after], axis=1)
        bg = Image.new("RGBA", (both.shape[1], both.shape[0]), (200, 230, 255, 255))
        bg.alpha_composite(Image.fromarray(both))
        bg.resize((bg.width * zoom, bg.height * zoom), Image.NEAREST).save(args.out)
        return 0

    rects = frame_rects(Path("src/assets/sprites.generated.ts"))
    fixed = process_sheet(data, rects)
    Image.fromarray(fixed).save(sheet2, optimize=True)

    # The 1x sheet keeps its own rasterisation everywhere but the frames that
    # were redrawn, which are taken from the redrawn 2x sheet by a 2:1 box filter.
    sheet1 = args.directory / "sheet-0.png"
    small = np.array(Image.open(sheet1).convert("RGBA"))
    for x, y, w, h in rects:
        small[y : y + h, x : x + w] = halve(fixed[y * 2 : (y + h) * 2, x * 2 : (x + w) * 2])
    Image.fromarray(small).save(sheet1, optimize=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
