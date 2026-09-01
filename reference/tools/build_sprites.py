#!/usr/bin/env python3
"""Curate the ffdec sprite export into src/assets/ and emit a typed manifest.

Placement is the whole problem here. ffdec crops each sprite PNG to the sprite's
bounds unioned over its frames, so drawing the art where Flash drew it needs
that (xmin, ymin) offset relative to the sprite's registration point.

There are two independent ways to get that offset, and this tool uses both.

The authority is ffdec's own SVG sprite export: each frame's root
`<g transform="matrix(1,0,0,1, tx, ty)">` shifts the art so its bounding box
starts at the SVG origin, so `(-tx, -ty)` is exactly the offset - unrounded, and
produced by the same tool that rasterised the PNGs. Pass that export with
`--svg-dir` (see below).

`sprite_bounds.py` computes the same quantity independently by walking the
display list. Where the two agree the entry is marked `verified: true`; where
they disagree the SVG value is still used and `verified: false` records that the
cross-check failed, which is a signal to investigate rather than a fallback.

Without `--svg-dir` the tool degrades to the old behaviour - resolver bounds
cross-checked against the PNG dimensions, centring on the registration point
when they disagree - which leaves six nested clips misplaced by up to 63 px.

Usage:
  python3 reference/tools/build_sprites.py <file.swf> <export-dir> <asset-dir> \
      [--svg-dir <dir>]

Not every sprite the game needs was a sprite in the SWF. The launcher - tower,
operator, swinging pillow, hamster wheels - is a band of loose layers inside
`background_mc`, so `COMPOSED` cuts those out by character id and crops each one
to its own ink. Their offsets are cross-checked the same way the plain sprites'
are, against `Resolver.subset_bounds`.

The frames are packed into texture atlas sheets rather than shipped as
individual files. That turns boot from hundreds of HTTP requests into one or two,
and it lets the WebGL renderer batch every sprite into a single draw call,
because they all live on one GPU texture. Identical frames share a rect.
Requires Pillow and cairosvg.

Produce the SVG export first:
  ffdec -format sprite:svg -export sprite <dir> <file.swf>
"""
import io
import math
import os
import re
import struct
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sprite_bounds import build

# name, character id, exported directory, fps (None = single frame, no loop)
SPRITES = [
    ('hamster/jump', 52, 'DefineSprite_52', 19),
    ('hamster/fly', 306, 'DefineSprite_306', 19),
    ('hamster/glide', 291, 'DefineSprite_291', 19),
    ('hamster/drop', 279, 'DefineSprite_279', 19),
    ('hamster/blur', 161, 'DefineSprite_161', 19),
    ('hamster/wind', 305, 'DefineSprite_305', 19),
    ('hamster/slide', 312, 'DefineSprite_312', 19),
    ('hamster/skid', 318, 'DefineSprite_318', 19),
    ('hamster/ball', 177, 'DefineSprite_177', 19),
    ('pillow', 234, 'DefineSprite_234', None),
    ('shadow', 21, 'DefineSprite_21_shadow', None),
    ('powerup/bounce', 454, 'DefineSprite_454__bounce', 19),
    ('powerup/speed', 465, 'DefineSprite_465__speed', 19),
    ('powerup/wind', 467, 'DefineSprite_467__wind', 19),
    ('powerup/slide', 463, 'DefineSprite_463__slide', 19),
    ('powerup/rebound', 462, 'DefineSprite_462__rebound', 19),
    ('powerup/superbounce', 466, 'DefineSprite_466__superbounce', 19),
    ('fx/bounce', 181, 'DefineSprite_181_bounce_fx', 19),
    ('fx/break', 149, 'DefineSprite_149_break', 19),
    ('fx/superBreak', 153, 'DefineSprite_153_super_break', 19),
    ('hit/faceplant', 372, 'DefineSprite_372_hit_faceplant', 19),
    ('hit/cheer', 351, 'DefineSprite_351_hit_cheer', 19),
    ('hit/hole', 365, 'DefineSprite_365_hit_hole', 19),
    ('hit/zero', 378, 'DefineSprite_378_hit_zero', 19),
    ('bush/1', 184, 'DefineSprite_184_bush1', None),
    ('bush/2', 185, 'DefineSprite_185_bush2', None),
    ('bush/3', 186, 'DefineSprite_186_bush3', None),
    ('bush/4', 187, 'DefineSprite_187_bush4', None),
    ('bush/5', 188, 'DefineSprite_188_bush5', None),
    ('cloud/1', 201, 'DefineSprite_201_cloud1', None),
    ('cloud/2', 203, 'DefineSprite_203_cloud2', None),
    ('cloud/3', 90, 'DefineSprite_90_cloud3', None),
    # The launcher end of the world, which the port used to leave out entirely.
    ('hud/launchArrow', 398, 'DefineSprite_398', None),
    ('hud/shotPip', 395, 'DefineSprite_395', None),
]

# Layer bands inside `background_mc` (145). The launcher was never a clip of its
# own - tower, operator, swing and wheels are loose layers of the backdrop - so
# these are cut out of the parent's frames by character id.
BACKDROP = {81, 82, 88}  # the sunset bar, the parallax hills, the starfield
SCENERY = {90, 91, 92}  # one cloud and two bush clumps; the port scatters its own
WHEELS = {114, 116}  # the two hamster wheels, which run on their own clock
FRAME = {98, 99, 121}  # the tower and the wheel poles; 99 becomes 121 at frame 4

# name, character id, exported directory, fps, frames (1-based, None = all),
# characters to keep, characters to drop
COMPOSED = [
    ('launcher/frame', 145, 'DefineSprite_145', None, [1], FRAME, None),
    (
        'launcher/swing',
        145,
        'DefineSprite_145',
        19,
        range(1, 50),
        None,
        BACKDROP | SCENERY | WHEELS | FRAME,
    ),
    ('launcher/wheel1', 145, 'DefineSprite_145', 19, range(1, 34), {114}, None),
    ('launcher/wheel2', 145, 'DefineSprite_145', 19, range(1, 31), {116}, None),
    # The needle is moved by the game, so it cannot stay baked into the dial.
    ('hud/launchMeter', 402, 'DefineSprite_402', None, [1], None, {398}),
    # Nothing to select here - this one is composed only to be trimmed. Two
    # thirds of ffdec's box is empty: the clip declares geometry 88 px above the
    # art that never renders, and that would be 109 blank rows in the atlas.
    ('queue/hamster', 53, 'DefineSprite_53', 19, None, None, None),
]

# The flight hamster's poses live inside the `arrow` clip (331) and are toggled
# by _visible, so each one also carries its placement translation in that clip.
PARENT_PLACEMENT = {
    'hamster/fly': (331, 'flying_mc'),
    'hamster/glide': (331, 'glide'),
    'hamster/drop': (331, 'drop'),
    'hamster/blur': (331, 'blur'),
    'hamster/wind': (331, 'wind'),
    'hamster/slide': (331, 'slide'),
    'hamster/skid': (331, 'skid'),
    'hamster/ball': (331, 'ball'),
}


SVG_ROOT_TRANSFORM = re.compile(
    r'<g transform="matrix\('
    r'[-\d.]+, [-\d.]+, [-\d.]+, [-\d.]+, ([-\d.]+), ([-\d.]+)\)'
)


SVG_CANVAS = re.compile(r'<svg [^>]*height="([\d.]+)px" width="([\d.]+)px"')


def svg_canvas(path):
    """The declared canvas of one ffdec frame, rounded up to whole pixels."""
    with open(path) as handle:
        head = handle.read(2048)
    found = SVG_CANVAS.search(head)
    if found is None:
        return None
    return math.ceil(float(found.group(2))), math.ceil(float(found.group(1)))


def svg_offset(svg_dir, directory):
    """`(ox, oy)` from ffdec's SVG export, or None when it is unavailable.

    Read from frame 1: ffdec crops every frame of a sprite to the same box, the
    one unioned over its frames, so the transform is identical on all of them.
    """
    src = os.path.join(svg_dir, directory)
    if not os.path.isdir(src):
        return None
    frames = sorted(
        (f for f in os.listdir(src) if f.endswith('.svg')),
        key=lambda f: int(f[:-4]),
    )
    if not frames:
        return None
    with open(os.path.join(src, frames[0])) as handle:
        head = handle.read(2048)
    found = SVG_ROOT_TRANSFORM.search(head)
    if found is None:
        return None
    return -float(found.group(1)), -float(found.group(2))


# 2048 is the size every WebGL implementation is required to support, and it is
# what the 1:1 atlas uses. Above 1:1 it is not enough - `hit/zero` alone is 36
# frames of 334x376 at 2x, which is more pixels than a 2048 sheet holds - and a
# sprite's frames have to stay on one sheet, so the limit rises with the scale.
# 4096 is not guaranteed by the spec but is supported essentially everywhere.
SHEET_BASE = 2048
SHEET_CAP = 4096
# A transparent gutter, so bilinear sampling at a frame edge reaches empty
# pixels instead of the neighbouring frame.
GUTTER = 2


CORE_ELEMENT = re.compile(r'<use[^>]*id="core"[^>]*/>')
USE_CHARACTER = re.compile(r'ffdec:characterId="(\d+)"')
SVG_WIDTH = re.compile(r'width="[\d.]+px"')
SVG_HEIGHT = re.compile(r'height="[\d.]+px"')


class Vector:
    """How to rasterise one sprite's frames out of ffdec's SVG export.

    A plain sprite takes each frame whole. A *composed* sprite also picks which
    of the clip's layers to keep and crops to what is left, which is the only
    way to reach the launcher: the original never defined it as a clip of its
    own, it is a band of layers inside `background_mc`.
    """

    def __init__(self, svg_dir, directory, frames=None, keep=None, drop=None, crop=None):
        self.dir = os.path.join(svg_dir, directory)
        self.frames = list(frames) if frames is not None else None
        self.keep = keep
        self.drop = drop
        self.crop = crop

    def with_crop(self, crop):
        return Vector(
            os.path.dirname(self.dir),
            os.path.basename(self.dir),
            self.frames,
            self.keep,
            self.drop,
            crop,
        )

    def source_frames(self):
        if self.frames is not None:
            return self.frames
        if not os.path.isdir(self.dir):
            return []
        return sorted(
            (int(f[:-4]) for f in os.listdir(self.dir) if f.endswith('.svg')),
        )

    def path(self, index):
        frames = self.source_frames()
        if index >= len(frames):
            return None
        return os.path.join(self.dir, f'{frames[index]}.svg')

    def markup(self, index, drop_core=False):
        path = self.path(index)
        if path is None or not os.path.isfile(path):
            return None
        with open(path) as handle:
            text = handle.read()
        if drop_core:
            text, count = CORE_ELEMENT.subn('', text)
            if count == 0:
                return None
        if self.keep is not None or self.drop is not None:
            text = self.select(text)
        if self.crop is not None:
            x0, y0, x1, y1 = self.crop
            text = SVG_WIDTH.sub(f'width="{x1 - x0}px"', text, count=1)
            text = SVG_HEIGHT.sub(f'height="{y1 - y0}px"', text, count=1)
            text = text.replace(
                '<svg ', f'<svg viewBox="{x0} {y0} {x1 - x0} {y1 - y0}" ', 1
            )
        return text

    def select(self, text):
        """Keep only the chosen layers of the root group.

        The root `<g>` holds one `<use>` per display-list depth, in depth order;
        what those point at lives further down in `<defs>`, which has to survive
        untouched - hence a line filter bounded to the root group rather than a
        substitution over the whole document.
        """
        lines = text.split('\n')
        start = next(
            i for i, line in enumerate(lines) if line.strip().startswith('<g transform=')
        )
        end = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == '</g>')
        body = []
        for line in lines[start + 1 : end]:
            found = USE_CHARACTER.search(line)
            if found is None:
                body.append(line)
                continue
            char = int(found.group(1))
            if self.keep is not None and char not in self.keep:
                continue
            if self.drop is not None and char in self.drop:
                continue
            body.append(line)
        return '\n'.join(lines[: start + 1] + body + lines[end:])

    def render(self, index, size, drop_core=False):
        text = self.markup(index, drop_core)
        if text is None:
            return None
        import cairosvg

        data = cairosvg.svg2png(
            bytestring=text.encode(), output_width=size[0], output_height=size[1]
        )
        return Image.open(io.BytesIO(data)).convert('RGBA')


def core_is_visible(vector, size):
    """Whether this sprite's hit-test box actually shows through the art.

    Flash never drew these - they exist so `hitTest` has a box, which is the
    same thing extract_hitboxes.py reads. ffdec does not know that and
    rasterises them like any other child.

    Decided by rendering the frame twice through the same rasteriser, with the
    node and without, and comparing. Diffing against ffdec's PNG instead would
    drown the answer in antialiasing differences between two engines; diffing a
    renderer against itself isolates exactly the core's contribution.

    An earlier version guessed from the flat raster - "is this rectangle all
    one colour?" - and reported a false positive on the rebound powerup, whose
    core happens to sit on a uniform patch of art, silently re-rendering a
    frame that was fine.
    """
    with_core = vector.render(0, size, drop_core=False)
    without = vector.render(0, size, drop_core=True)
    if with_core is None or without is None:
        return False
    from PIL import ImageChops

    diff = ImageChops.difference(with_core, without)
    changed = sum(1 for pixel in diff.get_flattened_data() if max(pixel) > 8)
    # A core that shows at all covers a real part of the frame; less than this
    # is the node sitting fully behind the art.
    return changed * 100 > size[0] * size[1] * 5


def load_frames(name, paths, vector, entry, cores, densities):
    """Every frame of one sprite, at every density, plus a map onto unique art.

    Frames repeat more often than they look like they should: `launcher/swing`
    holds one pose for twenty frames of the miss animation, and `queue/hamster`
    has eight pairs of duplicates. Hashing the 1:1 raster and giving identical
    frames one rect cuts those 49 and 26 frames to 25 and 18, which is the
    difference between two atlas sheets and three.
    """
    slots = []
    index_of = {}
    frame_map = []
    for index, path in enumerate(paths):
        variants = []
        for density in densities:
            box = (round(entry['w'] * density), round(entry['h'] * density))
            frame = None
            if vector is not None and (name in cores or density != 1 or path is None):
                # Three reasons to go back to the vector: a hit-test box to
                # leave out, a density ffdec's 1:1 raster cannot supply without
                # upscaling it, or a composed sprite that has no raster at all.
                frame = vector.render(index, box, drop_core=name in cores)
            if frame is None:
                if path is None:
                    raise SystemExit(f'{name}: frame {index} has neither raster nor vector')
                with Image.open(path) as opened:
                    frame = opened.convert('RGBA')
                if box != frame.size:
                    frame = frame.resize(box, Image.LANCZOS)
            variants.append(frame)
        key = variants[0].tobytes()
        at = index_of.get(key)
        if at is None:
            at = index_of[key] = len(slots)
            slots.append(variants)
        frame_map.append(at)
    return slots, frame_map


def pack_atlas(sources, entries, asset_dir, cores=None, svg=None, densities=(1,)):
    """Shelf-pack every frame into sheets and record where each one landed.

    Shelf packing rather than MaxRects: the frames of one sprite are identical
    in size and arrive together, so sorting by height leaves little waste, and
    the result is stable enough to diff between runs.
    """
    cores = cores or {}
    svg = svg or {}
    # Laid out once at 1:1. Every density reuses these coordinates multiplied by
    # its factor, so one set of rects in the manifest serves them all - and a
    # device that loads the 2x sheet needs no second manifest to read it.
    sheet_max = SHEET_BASE

    # Tallest sprite first, so shelves fill from the bottom up. Whole sprites
    # rather than loose frames: a sprite's frames all have to land on one sheet.
    order = sorted(
        sources, key=lambda s: (-entries[s[0]]['h'], s[0])
    )

    sheets = []
    placements = {}
    frame_maps = {}
    shelf_y = shelf_h = cursor_x = 0

    def new_sheet():
        nonlocal shelf_y, shelf_h, cursor_x
        sheets.append(
            [
                Image.new('RGBA', (round(sheet_max * d), round(sheet_max * d)), (0, 0, 0, 0))
                for d in densities
            ]
        )
        shelf_y = shelf_h = cursor_x = 0

    def place(name, slot, variants, w, h):
        nonlocal shelf_y, shelf_h, cursor_x
        if cursor_x + w + GUTTER > sheet_max:
            shelf_y += shelf_h + GUTTER
            shelf_h = 0
            cursor_x = 0
        if shelf_y + h + GUTTER > sheet_max:
            new_sheet()
        for at, density in enumerate(densities):
            sheets[-1][at].paste(
                variants[at], (round(cursor_x * density), round(shelf_y * density))
            )
        placements[(name, slot)] = (len(sheets) - 1, cursor_x, shelf_y)
        cursor_x += w + GUTTER
        shelf_h = max(shelf_h, h)

    new_sheet()
    for name, paths in order:
        entry = entries[name]
        slots, frame_map = load_frames(
            name, paths, svg.get(name), entry, cores, densities
        )
        frame_maps[name] = frame_map
        started = len(sheets) - 1
        for slot, variants in enumerate(slots):
            place(name, slot, variants, entry['w'], entry['h'])
        if placements[(name, len(slots) - 1)][0] != started:
            # It straddled. Drop what was placed and give it a fresh sheet: the
            # manifest carries one sheet index per sprite, and the WebGL backend
            # only batches into a single draw call while they share a texture.
            for slot in range(len(slots)):
                placements.pop((name, slot), None)
            new_sheet()
            for slot, variants in enumerate(slots):
                place(name, slot, variants, entry['w'], entry['h'])

    # A rolled-back sprite can leave the sheet it straddled onto empty. Drop
    # those and renumber, so the manifest never points at a blank sheet.
    live = sorted({sheet for sheet, _x, _y in placements.values()})
    renumber = {old: new for new, old in enumerate(live)}
    sheets = [sheets[old] for old in live]
    placements = {
        key: (renumber[sheet], x, y) for key, (sheet, x, y) in placements.items()
    }

    os.makedirs(asset_dir, exist_ok=True)
    total_bytes = 0
    for number, variants in enumerate(sheets):
        # Crop the tail: the last sheet is mostly empty, and a smaller PNG is a
        # smaller download and a smaller GPU upload.
        used = max(
            y + entries[name]['h']
            for (name, _slot), (on, _x, y) in placements.items()
            if on == number
        )
        for at, density in enumerate(densities):
            side = round(sheet_max * density)
            tail = min(side, round(used * density))
            suffix = '' if density == 1 else f'@{density}x'
            out = os.path.join(asset_dir, f'sheet-{number}{suffix}.png')
            variants[at].crop((0, 0, side, tail)).save(out, optimize=True)
            total_bytes += os.path.getsize(out)

    for name, _paths in sources:
        entries[name]['sheet'] = placements[(name, 0)][0]
        entries[name]['rects'] = [
            (placements[(name, slot)][1], placements[(name, slot)][2])
            for slot in frame_maps[name]
        ]

    return total_bytes, len(sheets)


def png_size(path):
    with open(path, 'rb') as handle:
        head = handle.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


def compose(resolver, svg_dir, entries, sources, svg, skipped):
    """Build the sprites the original never defined, out of a parent's layers.

    Two passes over the frames. The first renders the chosen layers over the
    parent's whole canvas and unions the ink boxes; the second is the packer's,
    which re-renders through a viewBox cropped to that union. Rendering the
    frames twice is worth it: it is the only way to know how much of a
    1408x1559 backdrop the launcher actually occupies, and the answer - 218x77
    for the swing - is the difference between an atlas that fits and one that
    does not.

    The offset needs no separate measurement. The crop box is in the parent's
    own SVG pixels, so subtracting the root transform puts it back in the
    registration-point space the manifest speaks.
    """
    for name, cid, directory, fps, frames, keep, drop in COMPOSED:
        base = Vector(svg_dir, directory, frames, keep, drop)
        first = base.path(0)
        if first is None or not os.path.isfile(first):
            skipped.append(f'{name}: no SVG export for {directory}')
            continue
        canvas = svg_canvas(first)
        offset = svg_offset(svg_dir, directory)
        if canvas is None or offset is None:
            skipped.append(f'{name}: cannot read the canvas of {directory}')
            continue

        count = len(base.source_frames())
        whole = base.with_crop((0, 0, canvas[0], canvas[1]))
        box = None
        for index in range(count):
            frame = whole.render(index, canvas)
            ink = None if frame is None else frame.getbbox()
            if ink is None:
                continue
            box = ink if box is None else (
                min(box[0], ink[0]), min(box[1], ink[1]),
                max(box[2], ink[2]), max(box[3], ink[3]),
            )
        if box is None:
            skipped.append(f'{name}: every frame came out empty')
            continue

        # `svg_offset` returns -tx; the crop is measured from the same origin.
        ox = box[0] - -offset[0]
        oy = box[1] - -offset[1]

        # The independent second opinion, same role the SVG/resolver agreement
        # plays for a plain sprite: the display list, walked over the same layer
        # selection. A raster box runs a pixel wide of a geometry box wherever a
        # stroke is antialiased, so the tolerance is a pixel and a half.
        computed = resolver.subset_bounds(cid, keep, drop, set(base.source_frames()))
        verified = False
        if computed is not None:
            want = (computed[0], computed[2], computed[1], computed[3])
            got = (ox, oy, ox + box[2] - box[0], oy + box[3] - box[1])
            verified = all(abs(a - b) <= 1.5 for a, b in zip(want, got))
            if not verified:
                skipped.append(
                    f'{name}: resolver box {tuple(round(v, 2) for v in want)} '
                    f'vs raster {tuple(round(v, 2) for v in got)}'
                )

        entry = {
            'frames': count,
            'w': box[2] - box[0],
            'h': box[3] - box[1],
            'ox': round(ox, 2),
            'oy': round(oy, 2),
            'verified': verified,
            'charId': cid,
        }
        if fps is not None:
            entry['fps'] = fps
        entries[name] = entry
        sources.append((name, [None] * count))
        svg[name] = base.with_crop(box)


def collect(resolver, export_dir, asset_dir, svg_dir=None, densities=(1,)):
    entries = {}
    sources = []
    cores = {}
    svg = {}
    skipped = []

    for name, cid, directory, fps in SPRITES:
        src = os.path.join(export_dir, 'sprites', directory)
        if not os.path.isdir(src):
            skipped.append(f'{name}: no export directory {directory}')
            continue

        pngs = sorted(
            (f for f in os.listdir(src) if f.endswith('.png')),
            key=lambda f: int(f[:-4]),
        )
        if not pngs:
            skipped.append(f'{name}: no frames')
            continue

        # ffdec's export is 1:1 with the stage, so its PNG size *is* the stage
        # box. Everything below stays in stage units; `scale` only enters when
        # the art is finally rasterised and when the frame box is written out.
        stage = png_size(os.path.join(src, pngs[0]))
        if stage is None:
            skipped.append(f'{name}: first frame is not a PNG')
            continue

        computed = resolver.bounds(cid)
        resolved = None
        if computed is not None:
            want_w = math.ceil(computed[1] - computed[0])
            want_h = math.ceil(computed[3] - computed[2])
            # Both sides in stage pixels. Comparing against the scaled art box
            # here is the unit mix that made every sprite fail this check at any
            # zoom other than 1, and fall back to a centred guess.
            if abs(want_w - stage[0]) <= 1 and abs(want_h - stage[1]) <= 1:
                resolved = (computed[0], computed[2])

        exported = svg_offset(svg_dir, directory) if svg_dir else None

        if exported is not None:
            ox, oy = exported
            # The flag now records whether the independent resolver agrees, not
            # whether we had to guess. The value used is ffdec's either way.
            verified = resolved is not None and (
                abs(resolved[0] - ox) < 0.01 and abs(resolved[1] - oy) < 0.01
            )
        elif resolved is not None:
            ox, oy = resolved
            verified = True
        else:
            # Stage units, so the fallback does not move when the art is scaled.
            ox, oy = -stage[0] / 2, -stage[1] / 2
            verified = False

        placement = PARENT_PLACEMENT.get(name)
        if placement is not None:
            found = resolver.child_placement(*placement)
            if found is not None:
                _child_cid, matrix = found
                ox += matrix[4]
                oy += matrix[5]

        # ffdec crops every frame of a sprite to the same box - the one unioned
        # over its frames - so a single w/h covers them all. Checked, not assumed.
        odd = next(
            (f for f in pngs if png_size(os.path.join(src, f)) != stage),
            None,
        )
        if odd is not None:
            skipped.append(f'{name}: frame {odd} differs in size from {stage}')
            continue

        sources.append((name, [os.path.join(src, f) for f in pngs]))
        if svg_dir is not None:
            vector = Vector(svg_dir, directory)
            svg[name] = vector
            if core_is_visible(vector, stage):
                cores[name] = vector

        entry = {
            'frames': len(pngs),
            'w': stage[0],
            'h': stage[1],
            'ox': round(ox, 2),
            'oy': round(oy, 2),
            'verified': verified,
            'charId': cid,
        }
        if fps is not None:
            entry['fps'] = fps
        entries[name] = entry

    if svg_dir is not None:
        compose(resolver, svg_dir, entries, sources, svg, skipped)
    elif COMPOSED:
        skipped.append('composed sprites need --svg-dir; the launcher is missing')

    total_bytes, sheets = pack_atlas(sources, entries, asset_dir, cores, svg, densities)
    return entries, total_bytes, sheets, skipped


HEADER = [
    '// GENERATED FILE - do not edit by hand.',
    '//',
    '// Produced by reference/tools/build_sprites.py from the original SWF.',
    '// Regenerate with:',
    '//   ffdec -format sprite:svg -export sprite reference/extracted/svg <file.swf>',
    '//   python3 reference/tools/build_sprites.py <file.swf> \\',
    '//     reference/extracted src/assets/sprites --svg-dir reference/extracted/svg',
    '//',
    '// `ox`/`oy` place the top-left of the image relative to the entity position,',
    '// so the renderer needs no per-sprite magic numbers.',
    '//',
    '// Frames are packed into atlas sheets in the same directory: one request',
    '// instead of 526, and one GPU texture so every sprite batches together.',
    '// Identical frames share a rect, so `rects` can repeat: the launcher holds',
    '// one pose for twenty frames of its miss animation.',
    '//',
    '// `w`/`h` and `rects` are stage pixels - the 1:1 layout. A higher-density',
    '// sheet reuses the same layout multiplied by its factor, so one manifest',
    '// serves them all and the loader only has to pick a file.',
    '//',
    '// `ox`/`oy` come from the root transform of ffdec\'s SVG sprite export, which',
    '// is exact and unrounded. `verified` records whether the independent',
    '// display-list walk in sprite_bounds.py agreed: false means the two methods',
    '// disagree and the entry is worth investigating, not that the value is a guess.',
    '//',
    '// The `launcher/*`, `queue/*` and `hud/launchMeter` entries are composed by',
    '// this tool rather than exported whole: the original never defined them as',
    '// clips, they are layers of `background_mc` (145). Their art is rasterised',
    '// from the SVG through a cropped viewBox, so their edges are antialiased by',
    '// cairosvg rather than by ffdec.',
    '',
    'export interface SpriteMeta {',
    '  readonly frames: number;',
    '  readonly w: number;',
    '  readonly h: number;',
    '  readonly ox: number;',
    '  readonly oy: number;',
    '  readonly verified: boolean;',
    '  readonly charId: number;',
    '  readonly fps?: number;',
    '  /** Which atlas sheet the frames live on. */',
    '  readonly sheet: number;',
    '  /** Top-left of each frame within that sheet; `w`/`h` are shared. */',
    '  readonly rects: readonly (readonly [number, number])[];',
    '}',
    '',
    'export const SPRITES = {',
]


def emit(entries, path, densities=(1,)):
    lines = list(HEADER)
    for name, entry in entries.items():
        fps = f", fps: {entry['fps']}" if 'fps' in entry else ''
        rects = ', '.join(f'[{x}, {y}]' for x, y in entry['rects'])
        lines.append(
            f"  '{name}': {{ frames: {entry['frames']}, w: {entry['w']}, "
            f"h: {entry['h']}, ox: {entry['ox']}, oy: {entry['oy']}, "
            f"verified: {str(entry['verified']).lower()}, "
            f"charId: {entry['charId']}{fps}, sheet: {entry['sheet']}, "
            f"rects: [{rects}] }},"
        )
    lines += [
        '} as const satisfies Record<string, SpriteMeta>;',
        '',
        'export type SpriteId = keyof typeof SPRITES;',
        '',
        '/** Atlas densities on disk, ascending. 1 is `sheet-N.png`, 2 is `sheet-N@2x.png`. */',
        f'export const DENSITIES = {list(densities)} as const;',
        '',
    ]
    with open(path, 'w') as handle:
        handle.write('\n'.join(lines))


def main():
    args = sys.argv[1:]
    svg_dir = None
    densities = (1, 2)
    if '--svg-dir' in args:
        at = args.index('--svg-dir')
        svg_dir = args[at + 1]
        del args[at:at + 2]
    if '--densities' in args:
        at = args.index('--densities')
        densities = tuple(int(part) for part in args[at + 1].split(','))
        del args[at:at + 2]
    if densities != (1,) and svg_dir is None:
        raise SystemExit('densities above 1 need --svg-dir: that art comes from the SVG')
    swf, export_dir, asset_dir = args[0], args[1], args[2]
    resolver = build(swf)
    entries, total_bytes, sheets, skipped = collect(
        resolver, export_dir, asset_dir, svg_dir, densities
    )
    emit(entries, os.path.join('src', 'assets', 'sprites.generated.ts'), densities)

    verified = sum(1 for e in entries.values() if e['verified'])
    source = 'ffdec SVG export' if svg_dir else 'display-list resolver'
    total_frames = sum(e['frames'] for e in entries.values())
    print(
        f'{len(entries)} sprites / {total_frames} frames on {sheets} atlas '
        f'sheet(s), offsets from the {source}, {verified} cross-checked clean, '
        f'{total_bytes / 1024:.0f} KiB of PNG'
    )
    for name, entry in entries.items():
        if not entry['verified']:
            note = 'resolver disagrees' if svg_dir else 'centred fallback'
            print(f'  {note}: {name} (char {entry["charId"]})')
    for line in skipped:
        print(f'  skipped: {line}')


if __name__ == '__main__':
    main()
