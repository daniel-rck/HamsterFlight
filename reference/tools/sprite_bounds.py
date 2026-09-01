#!/usr/bin/env python3
"""Union-over-frames bounds for every DefineSprite.

ffdec crops its sprite PNG export to the sprite's bounds unioned across all
frames, so the top-left of the exported image sits at (xmin, ymin) relative to
the sprite's registration point. Recovering those two numbers is what lets a
renderer place the art exactly where Flash placed it.

Getting it right needs a real display-list walk: a placement tag can place a new
character, or *move* one already at a depth without naming a character, and
RemoveObject2 takes one away. Ignoring the move tags undercounts the bounds of
every animated clip, and reading only PlaceObject2 misses the 24 PlaceObject3
placements this SWF uses - among them the launch tower and both halves of the
`_bounce` powerup.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swfparse import R, load, tags

SHAPE_TAGS = {2, 22, 32, 83}
MORPH_TAGS = {46, 84}
PLACE_TAGS = {26, 70}  # PlaceObject2 and PlaceObject3


def sbits(rd, n):
    if n == 0:
        return 0
    v = rd.bits(n)
    return v - (1 << n) if v >> (n - 1) else v


def srect(rd):
    rd.align()
    n = rd.bits(5)
    v = [sbits(rd, n) for _ in range(4)]
    rd.align()
    return v


def read_matrix(rd):
    rd.align()
    sx = sy = 1.0
    if rd.bits(1):
        n = rd.bits(5)
        sx = sbits(rd, n) / 65536.0
        sy = sbits(rd, n) / 65536.0
    r0 = r1 = 0.0
    if rd.bits(1):
        n = rd.bits(5)
        r0 = sbits(rd, n) / 65536.0
        r1 = sbits(rd, n) / 65536.0
    n = rd.bits(5)
    tx = sbits(rd, n)
    ty = sbits(rd, n)
    rd.align()
    return (sx, sy, r0, r1, tx / 20.0, ty / 20.0)


def read_name(rd):
    b = bytearray()
    while True:
        c = rd.u8()
        if c == 0:
            break
        b.append(c)
    return b.decode('latin1')


def read_place2(data):
    """Returns (depth, charId|None, matrix|None, name|None, is_move)."""
    rd = R(data)
    flags = rd.u8()
    depth = rd.u16()
    is_move = bool(flags & 1)
    cid = mat = name = None
    if flags & 2:
        cid = rd.u16()
    if flags & 4:
        mat = read_matrix(rd)
    if flags & 8:
        return depth, cid, mat, None, is_move  # colour transform: stop parsing
    if flags & 16:
        rd.u16()
    if flags & 32:
        name = read_name(rd)
    return depth, cid, mat, name, is_move


def read_place3(data):
    """PlaceObject3, in the same shape `read_place2` returns.

    Two extra flag bytes and two optional fields ahead of the character id, and
    that is all this needs: everything past the name - filters, blend mode,
    visibility - sits behind fields we never reach. Skipping tag 70 entirely,
    which is what this file used to do, loses 24 placements including the
    launch tower (`background_mc` depth 118) and every layer of the hills and
    starfield clips, so their bounds came out short.
    """
    rd = R(data)
    flags = rd.u8()
    flags2 = rd.u8()
    depth = rd.u16()
    is_move = bool(flags & 1)
    cid = mat = name = None
    # HasClassName, or HasImage together with HasCharacter, prefixes a name.
    if (flags2 & 8) or (flags2 & 16 and flags & 2):
        read_name(rd)
    if flags & 2:
        cid = rd.u16()
    if flags & 4:
        mat = read_matrix(rd)
    if flags & 8:
        return depth, cid, mat, None, is_move  # colour transform: stop parsing
    if flags & 16:
        rd.u16()
    if flags & 32:
        name = read_name(rd)
    return depth, cid, mat, name, is_move


def read_place(code, data):
    """Either placement tag, or None for anything else."""
    if code == 26:
        return read_place2(data)
    if code == 70:
        return read_place3(data)
    return None


def index_tags(tag_list, shapes, sprites):
    for code, _name, _off, data in tag_list:
        if code in SHAPE_TAGS or code in MORPH_TAGS:
            rd = R(data)
            cid = rd.u16()
            try:
                xn, xx, yn, yx = srect(rd)
                shapes[cid] = (xn / 20, xx / 20, yn / 20, yx / 20)
            except Exception:
                pass
        elif code == 39:
            rd = R(data)
            sid = rd.u16()
            rd.u16()
            inner = tags(data, rd.p)
            sprites[sid] = inner
            index_tags(inner, shapes, sprites)


def transform(box, matrix):
    sx, sy, _r0, _r1, tx, ty = matrix
    xs = (box[0] * sx + tx, box[1] * sx + tx)
    ys = (box[2] * sy + ty, box[3] * sy + ty)
    return (min(xs), max(xs), min(ys), max(ys))


def union(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return (min(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), max(a[3], b[3]))


class Resolver:
    def __init__(self, shapes, sprites):
        self.shapes = shapes
        self.sprites = sprites
        self.cache = {}
        self.frames = {}

    def bounds(self, cid, depth=0):
        """Union bounds of a character across all of its frames."""
        if cid in self.shapes:
            return self.shapes[cid]
        if cid in self.cache:
            return self.cache[cid]
        if cid not in self.sprites or depth > 10:
            return None
        self.cache[cid] = None  # cycle guard
        total = None
        count = 0
        display = {}
        for code, _name, _off, data in self.sprites[cid]:
            if code in PLACE_TAGS:
                try:
                    dep, ccid, mat, _nm, is_move = read_place(code, data)
                except Exception:
                    continue
                if ccid is not None:
                    display[dep] = [ccid, mat or (1.0, 1.0, 0.0, 0.0, 0.0, 0.0)]
                elif is_move and dep in display:
                    if mat is not None:
                        display[dep][1] = mat
            elif code == 28:  # RemoveObject2: depth only
                rd = R(data)
                display.pop(rd.u16(), None)
            elif code == 5:  # RemoveObject: charId then depth
                rd = R(data)
                rd.u16()
                display.pop(rd.u16(), None)
            elif code == 1:  # ShowFrame
                count += 1
                for ccid, mat in display.values():
                    child = self.bounds(ccid, depth + 1)
                    if child is not None:
                        total = union(total, transform(child, mat))
        self.cache[cid] = total
        self.frames[cid] = max(count, 1)
        return total

    def frame_count(self, cid):
        self.bounds(cid)
        return self.frames.get(cid, 1)

    def child_placement(self, sid, child_name):
        """The first placement matrix of a named child inside a sprite."""
        if sid not in self.sprites:
            return None
        for code, _name, _off, data in self.sprites[sid]:
            if code not in PLACE_TAGS:
                continue
            try:
                _dep, ccid, mat, name, _mv = read_place(code, data)
            except Exception:
                continue
            if name == child_name and ccid is not None and mat is not None:
                return ccid, mat
        return None


def build(swf_path):
    _sig, _ver, _flen, body = load(swf_path)
    rd = R(body)
    rd.rect()
    rd.u16()
    rd.u16()
    top = tags(body, rd.p)
    shapes, sprites = {}, {}
    index_tags(top, shapes, sprites)
    return Resolver(shapes, sprites)


if __name__ == '__main__':
    resolver = build(sys.argv[1])
    for cid in [int(a) for a in sys.argv[2:]] or [234, 21, 52, 306, 454, 465, 467]:
        b = resolver.bounds(cid)
        n = resolver.frame_count(cid)
        if b is None:
            print(f'{cid}: no bounds')
            continue
        print(
            f'{cid}: frames={n} bounds x[{b[0]:.2f}..{b[1]:.2f}] y[{b[2]:.2f}..{b[3]:.2f}]'
            f'  -> png {b[1] - b[0]:.2f} x {b[3] - b[2]:.2f}  offset ({b[0]:.2f}, {b[2]:.2f})'
        )
