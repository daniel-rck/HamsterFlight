#!/usr/bin/env python3
"""Curate the ffdec sprite export into src/assets/ and emit a typed manifest.

Placement is the whole problem here. ffdec crops each sprite PNG to the sprite's
bounds unioned over its frames, so drawing the art where Flash drew it needs
that (xmin, ymin) offset relative to the sprite's registration point.

`sprite_bounds.py` computes it from the display list. For nested sprites whose
children animate their own scale it can disagree with what ffdec actually
rendered, so every entry is cross-checked against the real PNG dimensions:

  * agreement (within the 1px ceil) -> `verified: true`, exact offset used;
  * disagreement -> `verified: false` and the art is centred on the
    registration point instead, which looks right and is honest about it.

Usage:
  python3 reference/tools/build_sprites.py <file.swf> <export-dir> <asset-dir>
"""
import math
import os
import shutil
import struct
import sys

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


def png_size(path):
    with open(path, 'rb') as handle:
        head = handle.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    return struct.unpack('>II', head[16:24])


def collect(resolver, export_dir, asset_dir):
    entries = {}
    total_bytes = 0
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
        verified = False
        ox = -size[0] / 2
        oy = -size[1] / 2

        if computed is not None:
            want_w = math.ceil(computed[1] - computed[0])
            want_h = math.ceil(computed[3] - computed[2])
            if abs(want_w - size[0]) <= 1 and abs(want_h - size[1]) <= 1:
                verified = True
                ox, oy = computed[0], computed[2]

        placement = PARENT_PLACEMENT.get(name)
        if placement is not None:
            found = resolver.child_placement(*placement)
            if found is not None:
                _child_cid, matrix = found
                ox += matrix[4]
                oy += matrix[5]

        out = os.path.join(asset_dir, name)
        os.makedirs(out, exist_ok=True)
        for index, png in enumerate(pngs):
            dst = os.path.join(out, f'{index:03d}.png')
            shutil.copyfile(os.path.join(src, png), dst)
            total_bytes += os.path.getsize(dst)

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

    return entries, total_bytes, skipped


HEADER = [
    '// GENERATED FILE - do not edit by hand.',
    '//',
    '// Produced by reference/tools/build_sprites.py from the original SWF.',
    '// Regenerate with:',
    '//   python3 reference/tools/build_sprites.py <file.swf> \\',
    '//     reference/extracted src/assets/sprites',
    '//',
    '// `ox`/`oy` place the top-left of the image relative to the entity position,',
    '// so the renderer needs no per-sprite magic numbers.',
    '//',
    '// `verified: false` means the computed display-list bounds disagreed with what',
    '// ffdec actually rasterised - nested clips that animate their own scale - so',
    '// the art is centred on the registration point instead. Those are the entries',
    '// to check first if something looks misplaced.',
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
    '}',
    '',
    'export const SPRITES = {',
]


def emit(entries, path):
    lines = list(HEADER)
    for name, entry in entries.items():
        fps = f", fps: {entry['fps']}" if 'fps' in entry else ''
        lines.append(
            f"  '{name}': {{ frames: {entry['frames']}, w: {entry['w']}, "
            f"h: {entry['h']}, ox: {entry['ox']}, oy: {entry['oy']}, "
            f"verified: {str(entry['verified']).lower()}, "
            f"charId: {entry['charId']}{fps} }},"
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
    swf, export_dir, asset_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    resolver = build(swf)
    entries, total_bytes, skipped = collect(resolver, export_dir, asset_dir)
    emit(entries, os.path.join('src', 'assets', 'sprites.generated.ts'))

    verified = sum(1 for e in entries.values() if e['verified'])
    print(
        f'{len(entries)} sprites, {verified} with verified offsets, '
        f'{total_bytes / 1024:.0f} KiB of PNG'
    )
    for name, entry in entries.items():
        if not entry['verified']:
            print(f'  unverified offset (centred): {name} (char {entry["charId"]})')
    for line in skipped:
        print(f'  skipped: {line}')


if __name__ == '__main__':
    main()
