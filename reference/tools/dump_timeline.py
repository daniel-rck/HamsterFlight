"""Dump what the frame scripts act on: every clip's display list, frame labels
and timeline sounds.

    python3 reference/tools/dump_timeline.py <file.swf> [char-id ...]

With no ids it walks the root timeline and every DefineSprite. The frame
scripts themselves are in `reference/as2/timeline/` (ffdec `-export script`);
this is the other half they need to be read against - which child sits at
which depth under which instance name, with which matrix, and which
`StartSound` fires on which frame. None of that is in the decompiler output.

Matrices print as `[a, b, c, d, tx, ty]` in Flash's order: x' = a*x + c*y + tx,
y' = b*x + d*y + ty. So `[0, -1, 1, 0, ...]` is a quarter turn anticlockwise.
"""

import struct
import sys

from swfparse import R, load, tags


def _sb(v, n):
    return v - (1 << n) if n and v >> (n - 1) else v


def matrix(r):
    r.align()
    a = d = 1.0
    b = c = 0.0
    if r.bits(1):
        n = r.bits(5)
        a = _sb(r.bits(n), n) / 65536
        d = _sb(r.bits(n), n) / 65536
    if r.bits(1):
        n = r.bits(5)
        b = _sb(r.bits(n), n) / 65536
        c = _sb(r.bits(n), n) / 65536
    n = r.bits(5)
    tx = _sb(r.bits(n), n) / 20
    ty = _sb(r.bits(n), n) / 20
    r.align()
    return [a, b, c, d, tx, ty]


def place_object2(data):
    """(depth, char or None, matrix or None, name or None, move)."""
    flags = data[0]
    depth = struct.unpack_from('<H', data, 1)[0]
    r = R(data)
    r.p = 3
    char = None
    if flags & 0x02:
        char = r.u16()
    m = matrix(r) if flags & 0x04 else None
    if flags & 0x08:
        # CXFORMWITHALPHA - skipped, but it has to be read past.
        r.align()
        add, mul, n = r.bits(1), r.bits(1), r.bits(4)
        r.bits(n * 4 * (add + mul))
        r.align()
    if flags & 0x10:
        r.u16()  # ratio
    name = None
    if flags & 0x20:
        end = data.index(b'\0', r.p)
        name = data[r.p:end].decode('latin1')
    return depth, char, m, name, bool(flags & 0x01)


def fmt(m):
    return '[' + ', '.join(f'{v:g}' for v in m) + ']'


def dump(owner, tag_list):
    frame = 1
    for code, _name, _pos, data in tag_list:
        if code == 1:
            frame += 1
        elif code == 43:
            label = data.split(b'\0')[0].decode('latin1')
            print(f'{owner} f{frame} label {label}')
        elif code == 26:
            depth, char, m, name, move = place_object2(data)
            bits = [f'd{depth}']
            if char is not None:
                bits.append(f'char {char}')
            if name:
                bits.append(f'"{name}"')
            if m is not None:
                bits.append(fmt(m))
            if move:
                bits.append('move')
            print(f'{owner} f{frame} place ' + ' '.join(bits))
        elif code == 28:
            print(f'{owner} f{frame} remove d{struct.unpack_from("<H", data, 0)[0]}')
        elif code == 15:
            print(f'{owner} f{frame} sound {struct.unpack_from("<H", data, 0)[0]}')
        elif code == 12:
            print(f'{owner} f{frame} script')


def main():
    _sig, _ver, _flen, body = load(sys.argv[1])
    r = R(body)
    r.rect()
    r.u16()
    r.u16()
    top = tags(body, r.p)
    wanted = {int(a) for a in sys.argv[2:]}
    if not wanted:
        dump('root', top)
    for code, _name, _pos, data in top:
        if code == 39:
            cid = struct.unpack_from('<H', data, 0)[0]
            if not wanted or cid in wanted:
                dump(f'sprite {cid}', tags(data, 4))


if __name__ == '__main__':
    main()
