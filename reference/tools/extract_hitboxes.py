#!/usr/bin/env python3
"""Extract the AABB hitboxes the original game collides with.

Flash `hitTest(clip)` is an axis-aligned bounding-box test in global space, so a
faithful port needs the real bounds of the `core` subclips. Those are not stored
on DefineSprite - they have to be resolved by unioning the child DefineShape
bounds through the PlaceObject2 matrices, scale included.

Emits a TypeScript module on stdout.

    python3 reference/tools/extract_hitboxes.py <file.swf> > src/sim/hitboxes.generated.ts
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swfparse import load, R, tags

SHAPE = {2, 22, 32, 83}
MORPH = {46, 84}


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


def matrix(rd):
    """Full PlaceObject2 MATRIX. Scale is essential: the `core` clips are scaled."""
    rd.align()
    sx = sy = 1.0
    if rd.bits(1):
        n = rd.bits(5)
        sx = sbits(rd, n) / 65536.0
        sy = sbits(rd, n) / 65536.0
    if rd.bits(1):
        n = rd.bits(5)
        sbits(rd, n)
        sbits(rd, n)
    n = rd.bits(5)
    tx = sbits(rd, n)
    ty = sbits(rd, n)
    rd.align()
    return sx, sy, tx / 20.0, ty / 20.0


def place(data):
    rd = R(data)
    f = rd.u8()
    depth = rd.u16()
    cid = mat = name = None
    if f & 2:
        cid = rd.u16()
    if f & 4:
        mat = matrix(rd)
    if f & 8:
        return depth, cid, mat, None
    if f & 16:
        rd.u16()
    if f & 32:
        b = bytearray()
        while True:
            c = rd.u8()
            if c == 0:
                break
            b.append(c)
        name = b.decode("latin1")
    return depth, cid, mat, name


def index(tlist, shapes, sprites):
    for code, nm, off, data in tlist:
        if code in SHAPE or code in MORPH:
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
            st = tags(data, rd.p)
            sprites[sid] = st
            index(st, shapes, sprites)


def bounds(cid, shapes, sprites, memo, depth=0):
    if cid in shapes:
        return shapes[cid]
    if cid in memo:
        return memo[cid]
    if cid not in sprites or depth > 8:
        return None
    memo[cid] = None
    acc = None
    for code, nm, off, data in sprites[cid]:
        if code != 26:
            continue
        try:
            _d, ccid, mat, _n = place(data)
        except Exception:
            continue
        if ccid is None:
            continue
        cb = bounds(ccid, shapes, sprites, memo, depth + 1)
        if cb is None:
            continue
        sx, sy, tx, ty = mat if mat else (1.0, 1.0, 0.0, 0.0)
        xs = (cb[0] * sx + tx, cb[1] * sx + tx)
        ys = (cb[2] * sy + ty, cb[3] * sy + ty)
        b = (min(xs), max(xs), min(ys), max(ys))
        acc = b if acc is None else (
            min(acc[0], b[0]), max(acc[1], b[1]), min(acc[2], b[2]), max(acc[3], b[3]))
    memo[cid] = acc
    return acc


def child_box(sid, child_name, shapes, sprites, memo):
    """Bounds of a named child clip, expressed in the parent sprite's own space."""
    if sid not in sprites:
        return None
    for code, nm, off, data in sprites[sid]:
        if code != 26:
            continue
        try:
            _d, ccid, mat, name = place(data)
        except Exception:
            continue
        if name != child_name or ccid is None or mat is None:
            continue
        cb = bounds(ccid, shapes, sprites, memo)
        if cb is None:
            continue
        sx, sy, tx, ty = mat
        xs = (cb[0] * sx + tx, cb[1] * sx + tx)
        ys = (cb[2] * sy + ty, cb[3] * sy + ty)
        return (min(xs), max(xs), min(ys), max(ys), ccid)
    return None


def as_box(b):
    xn, xx, yn, yx = b[0], b[1], b[2], b[3]
    return dict(hw=(xx - xn) / 2, hh=(yx - yn) / 2, cx=(xn + xx) / 2, cy=(yn + yx) / 2)


def main():
    swf = sys.argv[1]
    sig, ver, flen, body = load(swf)
    rd = R(body)
    rd.rect()
    rd.u16()
    rd.u16()
    tl = tags(body, rd.p)
    shapes, sprites = {}, {}
    index(tl, shapes, sprites)
    memo = {}

    # Sprite ids resolved from the ExportAssets table and the PlaceObject2 names.
    TARGETS = [
        ("hamsterJumpCore", 52, "core", "hamster.core during the jump phase"),
        ("hamsterFlightCore", 331, "core", "the arrow/flight clip's core"),
        ("powerupBounce", 454, "core", "_bounce"),
        ("powerupRebound", 462, "core", "_rebound"),
        ("powerupSlide", 463, "core", "_slide"),
        ("powerupSpeed", 465, "core", "_speed"),
        ("powerupSuperbounce", 466, "core", "_superbounce"),
        ("powerupWind", 467, "core", "_wind"),
    ]

    out = {}
    notes = {}
    for key, sid, child, desc in TARGETS:
        got = child_box(sid, child, shapes, sprites, memo)
        if got is None:
            notes[key] = f"NOT RESOLVED (sprite {sid} child '{child}')"
            continue
        out[key] = as_box(got)
        notes[key] = f"{desc}; DefineSprite {sid} -> char {got[4]}"

    # The pillow is hit-tested as a whole clip, not via a `core` child:
    #   Game.as:1124  hamster.core.hitTest(pillow)
    pb = bounds(234, shapes, sprites, memo)
    if pb:
        out["pillow"] = as_box(pb)
        notes["pillow"] = "whole clip bounds; char 234"

    w = sys.stdout.write
    w("// GENERATED FILE - do not edit by hand.\n")
    w("//\n")
    w("// Produced by reference/tools/extract_hitboxes.py from the original SWF\n")
    w("// (CWS v8, sha256:86b4de0d112e057d73465d337513750a2c114d226a946e9f5f7dff7b50c558b6).\n")
    w("// Regenerate with:\n")
    w("//   python3 reference/tools/extract_hitboxes.py <file.swf> \\\n")
    w("//     > src/sim/hitboxes.generated.ts\n")
    w("//\n")
    w("// These close gap 13.1 of the reverse-engineering document: Flash hitTest is\n")
    w("// an AABB test, and these are the real bounds of the `core` subclips, resolved\n")
    w("// through the PlaceObject2 matrices with scale applied. Values are pixels in\n")
    w("// the owning clip's local space; `cx`/`cy` offset the box centre from the\n")
    w("// clip's registration point.\n")
    w("\n")
    w("import type { Box } from './math/aabb.ts';\n")
    w("\n")
    w("export const HITBOXES = {\n")
    for key in out:
        b = out[key]
        w(f"  /** {notes[key]} */\n")
        w(f"  {key}: {{ hw: {b['hw']:.4f}, hh: {b['hh']:.4f}, "
          f"cx: {b['cx']:.4f}, cy: {b['cy']:.4f} }},\n")
    w("} as const satisfies Record<string, Box>;\n")
    w("\n")
    w("export type HitboxId = keyof typeof HITBOXES;\n")
    for key, note in notes.items():
        if key not in out:
            sys.stderr.write(f"warning: {key}: {note}\n")


if __name__ == "__main__":
    main()
