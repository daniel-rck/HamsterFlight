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

The 382 frames are packed into texture atlas sheets rather than shipped as
individual files. That turns boot from 382 HTTP requests into one or two, and it
lets the WebGL renderer batch every sprite into a single draw call, because they
all live on one GPU texture. Requires Pillow.

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


# 2048 is the texture size every WebGL implementation is required to support.
SHEET_MAX = 2048
# A transparent gutter, so bilinear sampling at a frame edge reaches empty
# pixels instead of the neighbouring frame.
GUTTER = 2


CORE_ELEMENT = re.compile(r'<use[^>]*id="core"[^>]*/>')


def render_svg(svg_dir, directory, index, size, drop_core):
    """Rasterise one frame's SVG, optionally without its hit-test box."""
    path = os.path.join(svg_dir, directory, f'{index + 1}.svg')
    if not os.path.isfile(path):
        return None
    with open(path) as handle:
        markup = handle.read()
    if drop_core:
        markup, count = CORE_ELEMENT.subn('', markup)
        if count == 0:
            return None
    import cairosvg

    data = cairosvg.svg2png(
        bytestring=markup.encode(), output_width=size[0], output_height=size[1]
    )
    return Image.open(io.BytesIO(data)).convert('RGBA')


def core_is_visible(svg_dir, directory, size):
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
    with_core = render_svg(svg_dir, directory, 0, size, drop_core=False)
    without = render_svg(svg_dir, directory, 0, size, drop_core=True)
    if with_core is None or without is None:
        return False
    from PIL import ImageChops

    diff = ImageChops.difference(with_core, without)
    changed = sum(1 for pixel in diff.get_flattened_data() if max(pixel) > 8)
    # A core that shows at all covers a real part of the frame; less than this
    # is the node sitting fully behind the art.
    return changed * 100 > size[0] * size[1] * 5


def pack_atlas(sources, entries, asset_dir, cores=None):
    """Shelf-pack every frame into sheets and record where each one landed.

    Shelf packing rather than MaxRects: the frames of one sprite are identical
    in size and arrive together, so sorting by height leaves little waste, and
    the result is stable enough to diff between runs.
    """
    cores = cores or {}
    frames = [
        (name, index, path, entries[name]['w'], entries[name]['h'])
        for name, paths in sources
        for index, path in enumerate(paths)
    ]
    # Tallest first, then grouped by sprite so a sprite's frames stay adjacent.
    frames.sort(key=lambda f: (-f[4], f[0], f[1]))

    sheets = []
    placements = {}
    shelf_y = shelf_h = cursor_x = 0

    def new_sheet():
        nonlocal shelf_y, shelf_h, cursor_x
        sheets.append(Image.new('RGBA', (SHEET_MAX, SHEET_MAX), (0, 0, 0, 0)))
        shelf_y = shelf_h = cursor_x = 0

    new_sheet()
    for name, index, path, w, h in frames:
        if cursor_x + w + GUTTER > SHEET_MAX:
            shelf_y += shelf_h + GUTTER
            shelf_h = 0
            cursor_x = 0
        if shelf_y + h + GUTTER > SHEET_MAX:
            new_sheet()
        core = cores.get(name)
        frame = None
        if core is not None:
            frame = render_svg(core[0], core[1], index, (w, h), drop_core=True)
        if frame is None:
            with Image.open(path) as opened:
                frame = opened.convert('RGBA')
        sheets[-1].paste(frame, (cursor_x, shelf_y))
        placements[(name, index)] = (len(sheets) - 1, cursor_x, shelf_y)
        cursor_x += w + GUTTER
        shelf_h = max(shelf_h, h)

    os.makedirs(asset_dir, exist_ok=True)
    total_bytes = 0
    for number, sheet in enumerate(sheets):
        # Crop the tail: the last sheet is mostly empty, and a smaller PNG is a
        # smaller download and a smaller GPU upload.
        used = max(
            y + entries[name]['h']
            for (name, _index), (on, _x, y) in placements.items()
            if on == number
        )
        out = os.path.join(asset_dir, f'sheet-{number}.png')
        sheet.crop((0, 0, SHEET_MAX, min(SHEET_MAX, used))).save(out, optimize=True)
        total_bytes += os.path.getsize(out)

    for name, paths in sources:
        spread = {placements[(name, i)][0] for i in range(len(paths))}
        if len(spread) > 1:
            raise SystemExit(f'{name}: frames split across sheets {sorted(spread)}')
        entries[name]['sheet'] = placements[(name, 0)][0]
        entries[name]['rects'] = [
            (placements[(name, i)][1], placements[(name, i)][2])
            for i in range(len(paths))
        ]

    return total_bytes, len(sheets)


def png_size(path):
    with open(path, 'rb') as handle:
        head = handle.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


def collect(resolver, export_dir, asset_dir, svg_dir=None):
    entries = {}
    sources = []
    cores = {}
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

        size = png_size(os.path.join(src, pngs[0]))
        if size is None:
            skipped.append(f'{name}: first frame is not a PNG')
            continue

        computed = resolver.bounds(cid)
        resolved = None
        if computed is not None:
            want_w = math.ceil(computed[1] - computed[0])
            want_h = math.ceil(computed[3] - computed[2])
            if abs(want_w - size[0]) <= 1 and abs(want_h - size[1]) <= 1:
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
            ox, oy = -size[0] / 2, -size[1] / 2
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
            (f for f in pngs if png_size(os.path.join(src, f)) != size),
            None,
        )
        if odd is not None:
            skipped.append(f'{name}: frame {odd} differs in size from {size}')
            continue

        sources.append((name, [os.path.join(src, f) for f in pngs]))
        if svg_dir is not None and core_is_visible(svg_dir, directory, size):
            cores[name] = (svg_dir, directory)

        entry = {
            'frames': len(pngs),
            'w': size[0],
            'h': size[1],
            'ox': round(ox, 2),
            'oy': round(oy, 2),
            'verified': verified,
            'charId': cid,
        }
        if fps is not None:
            entry['fps'] = fps
        entries[name] = entry

    total_bytes, sheets = pack_atlas(sources, entries, asset_dir, cores)
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
    '// instead of 382, and one GPU texture so every sprite batches together.',
    '//',
    '// `ox`/`oy` come from the root transform of ffdec\'s SVG sprite export, which',
    '// is exact and unrounded. `verified` records whether the independent',
    '// display-list walk in sprite_bounds.py agreed: false means the two methods',
    '// disagree and the entry is worth investigating, not that the value is a guess.',
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


def emit(entries, path):
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
    ]
    with open(path, 'w') as handle:
        handle.write('\n'.join(lines))


def main():
    args = sys.argv[1:]
    svg_dir = None
    if '--svg-dir' in args:
        at = args.index('--svg-dir')
        svg_dir = args[at + 1]
        del args[at:at + 2]
    swf, export_dir, asset_dir = args[0], args[1], args[2]
    resolver = build(swf)
    entries, total_bytes, sheets, skipped = collect(
        resolver, export_dir, asset_dir, svg_dir
    )
    emit(entries, os.path.join('src', 'assets', 'sprites.generated.ts'))

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
