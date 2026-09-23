"""Pull the game's sounds out of the SWF as MP3 files, and a typed manifest.

    python3 reference/tools/build_sounds.py <file.swf> src/assets/sounds

Every DefineSound in this SWF is MP3 (format 2), so no transcoding is needed:
the tag body after its 7-byte header is a 2-byte SeekSamples count followed by
plain MP3 frames, which is a playable file on its own. SeekSamples is the
encoder's latency - how many decoded samples to skip before the sound starts -
and it goes into the manifest with the sample count, so a player can loop the
sound on its real extent instead of on the decoder's padding.

Two kinds of sound are taken:

- the ones `Game.initSounds()` attaches by linkage name (Game.as:249-265), and
- the ones clip timelines start with a `StartSound` tag - the cheer, the hole,
  the speed and rebound pickups, the tumbling ball, the launcher wheel and the
  game-over fanfare - which have no linkage name and are found by character id
  (see `as2/timeline/display-lists.txt`, `sound` lines).

The title music (484, root frame 5) and sprite 487's preload-everything frame
are not taken: the port has no title screen, and 487 is never shown.
"""

import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swfparse import R, load, tags

# SoundId in src/sim/events.ts -> linkage name or character id.
SOUNDS = {
    'shoot': 'snd_shoot',
    'fly': 'snd_fly',
    'wind': 'snd_wind',
    'bounce': 'snd_bounce',
    'superbounce': 'snd_superbounce',
    'hit': 'snd_hit',
    'pickup': 'snd_pickup',
    'bump': 'snd_bump',
    'slide': 'snd_slide',
    'skid': 'snd_skid',
    'prelude': 'snd_prelude',
    'theme': 'snd_theme',
    'ending': 'snd_ending',
    # Clip 52 frame 23, and hit_cheer frame 27.
    'jump': 'snd_jump',
    # Clip 51 frame 1 - the tumbling ball, restarted on every loop.
    'tumble': 47,
    # Clip 116 (hamsterWheel2) frame 2.
    'wheel': 115,
    # hit_cheer frame 5.
    'cheer': 337,
    # hit_hole frame 1.
    'hole': 354,
    # hit_hole frame 28 and gameOver_mc frame 60.
    'fanfare': 258,
    # _rebound frame 4.
    'rebound': 457,
    # _speed frame 2.
    'speed': 464,
}

RATES = [5512, 11025, 22050, 44100]


def main():
    swf, out_dir = sys.argv[1], sys.argv[2]
    _sig, _ver, _flen, body = load(swf)
    r = R(body)
    r.rect()
    r.u16()
    r.u16()
    top = tags(body, r.p)

    exports = {}
    sounds = {}
    for code, _name, _pos, data in top:
        if code == 56:  # ExportAssets
            count = struct.unpack_from('<H', data, 0)[0]
            p = 2
            for _ in range(count):
                cid = struct.unpack_from('<H', data, p)[0]
                end = data.index(b'\0', p + 2)
                exports[data[p + 2:end].decode('latin1')] = cid
                p = end + 1
        elif code == 14:  # DefineSound
            cid, flags = struct.unpack_from('<HB', data, 0)
            samples = struct.unpack_from('<I', data, 3)[0]
            sounds[cid] = (flags, samples, data[7:])

    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    total = 0
    for sound_id, ref in SOUNDS.items():
        cid = exports[ref] if isinstance(ref, str) else ref
        flags, samples, payload = sounds[cid]
        fmt = flags >> 4
        if fmt != 2:
            raise SystemExit(f'{sound_id} (char {cid}) is format {fmt}, not MP3')
        rate = RATES[(flags >> 2) & 3]
        seek = struct.unpack_from('<h', payload, 0)[0]
        mp3 = payload[2:]
        with open(os.path.join(out_dir, f'{sound_id}.mp3'), 'wb') as handle:
            handle.write(mp3)
        total += len(mp3)
        manifest.append((sound_id, cid, rate, seek, samples))

    lines = [
        '// GENERATED FILE - do not edit by hand.',
        '//',
        '// Produced by reference/tools/build_sounds.py from the original SWF:',
        '//   python3 reference/tools/build_sounds.py <file.swf> src/assets/sounds',
        '//',
        "// `seek` and `samples` are the DefineSound's own: the encoder latency to",
        '// skip, and the sound\'s length, both at `rate`.',
        '',
        'import type { SoundId } from "@/sim/events.ts";',
        '',
        'export interface SoundMeta {',
        '  readonly charId: number;',
        '  readonly rate: number;',
        '  readonly seek: number;',
        '  readonly samples: number;',
        '}',
        '',
        'export const SOUNDS = {',
    ]
    for sound_id, cid, rate, seek, samples in manifest:
        lines.append(
            f'  {sound_id}: {{ charId: {cid}, rate: {rate}, seek: {seek}, samples: {samples} }},'
        )
    lines += [
        '} as const satisfies Record<SoundId, SoundMeta>;',
        '',
    ]
    with open(os.path.join('src', 'assets', 'sounds.generated.ts'), 'w') as handle:
        handle.write('\n'.join(lines))
    print(f'{len(manifest)} sounds, {total / 1024:.0f} KiB of MP3')


if __name__ == '__main__':
    main()
