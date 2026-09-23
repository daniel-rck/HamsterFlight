"""Rasterise the INSTRUCTIONS board and its Play Now! button.

    ffdec -format frame:svg -select 6 -export frame <frame-dir> <file.swf>
    ffdec -format shape:svg -export shape <shape-dir> <file.swf>
    python3 reference/tools/build_screens.py <frame-dir>/6.svg <shape-dir> src/assets/screens

Root frame 6 is the whole game scene with the instructions laid over it:
`chalkboard_mc` (198 - a half-transparent green sheet framed by planks), the
text (DefineText 502, set in an embedded font, so it has to be rasterised),
the underline under the title (194) and the six pickup icons. This keeps
exactly those top-level placements of ffdec's frame export and drops the scene
under them, so the board comes out as a transparent overlay at stage size.

The button (503) is two pictures: up is shape 253 under the lettering 410,
over and down are 256 under it (DefineButton2 records). It is placed at
(331, 306) on the stage, which the page reproduces.

Output is WebP at 1x and 2x - one request each, and the board is mostly a
flat translucent fill that compresses to almost nothing.
"""

import io
import os
import re
import sys

import cairosvg
from PIL import Image

# Root frame 6 placements that make up the board, by character id: the board,
# the title underline, the text, and the icons - rocket 412, pink ball 333 +
# 379, fan 215 + 219, skateboard 294, spring 462, yellow ball 382 + 387.
BOARD = {'198', '194', '502', '412', '333', '379', '215', '219', '294', '462', '382', '387'}
STAGE = (600, 400)
BUTTON = (280, 100)
DENSITIES = (1, 2)

TOP_USE = re.compile(r'<use ffdec:characterId="(\d+)"[^>]*/>')


BACKGROUND = re.compile(r'<rect fill="#[0-9a-f]{6}" height="400.0px" width="600.0px"/>\s*')


def board_svg(frame_svg):
    """The frame with every top-level placement but the board's removed."""
    with open(frame_svg) as handle:
        text = handle.read()
    # ffdec writes the stage colour and then the top-level placements, in
    # depth order, ahead of the <defs> that hold every character's own
    # contents - so only the part before <defs> is touched.
    defs = text.index('<defs>')
    head, rest = text[:defs], text[defs:]

    def keep(match):
        return match.group(0) if match.group(1) in BOARD else ''

    head = BACKGROUND.sub('', head, count=1)
    return TOP_USE.sub(keep, head) + rest


def render(svg_text, size, scale):
    png = cairosvg.svg2png(
        bytestring=svg_text.encode(),
        output_width=size[0] * scale,
        output_height=size[1] * scale,
    )
    return Image.open(io.BytesIO(png)).convert('RGBA')


def main():
    frame_svg, shape_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)
    board = board_svg(frame_svg)
    shapes = {}
    for cid in ('253', '256', '410'):
        with open(os.path.join(shape_dir, f'{cid}.svg')) as handle:
            shapes[cid] = handle.read()

    for scale in DENSITIES:
        suffix = '' if scale == 1 else f'@{scale}x'
        image = render(board, STAGE, scale)
        image.save(os.path.join(out_dir, f'instructions{suffix}.webp'), quality=90, method=6)
        letters = render(shapes['410'], BUTTON, scale)
        for state, plank in (('up', '253'), ('over', '256')):
            button = render(shapes[plank], BUTTON, scale)
            button.alpha_composite(letters)
            button.save(os.path.join(out_dir, f'play-{state}{suffix}.webp'), quality=90, method=6)

    total = sum(os.path.getsize(os.path.join(out_dir, f)) for f in os.listdir(out_dir))
    print(f'{len(os.listdir(out_dir))} files, {total / 1024:.0f} KiB')


if __name__ == '__main__':
    main()
