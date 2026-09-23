// GENERATED FILE - do not edit by hand.
//
// Produced by reference/tools/build_sounds.py from the original SWF:
//   python3 reference/tools/build_sounds.py <file.swf> src/assets/sounds
//
// `seek` and `samples` are the DefineSound's own: the encoder latency to
// skip, and the sound's length, both at `rate`.

import type { SoundId } from "@/sim/events.ts";

export interface SoundMeta {
  readonly charId: number;
  readonly rate: number;
  readonly seek: number;
  readonly samples: number;
}

export const SOUNDS = {
  shoot: { charId: 479, rate: 22050, seek: 1670, samples: 8832 },
  fly: { charId: 486, rate: 22050, seek: 1669, samples: 173273 },
  wind: { charId: 485, rate: 44100, seek: 1695, samples: 26752 },
  bounce: { charId: 471, rate: 44100, seek: 1695, samples: 20352 },
  superbounce: { charId: 483, rate: 22050, seek: 1670, samples: 15648 },
  hit: { charId: 475, rate: 44100, seek: 1695, samples: 20064 },
  pickup: { charId: 477, rate: 44100, seek: 1695, samples: 27554 },
  bump: { charId: 132, rate: 44100, seek: 1695, samples: 4784 },
  slide: { charId: 481, rate: 44100, seek: 1695, samples: 79319 },
  skid: { charId: 480, rate: 44100, seek: 1695, samples: 33024 },
  prelude: { charId: 478, rate: 22050, seek: 1670, samples: 150900 },
  theme: { charId: 476, rate: 22050, seek: 1670, samples: 1350087 },
  ending: { charId: 472, rate: 22050, seek: 1670, samples: 106302 },
  jump: { charId: 347, rate: 22050, seek: 1670, samples: 1956 },
  tumble: { charId: 47, rate: 44100, seek: 1695, samples: 20206 },
  wheel: { charId: 115, rate: 44100, seek: 1695, samples: 34544 },
  cheer: { charId: 337, rate: 22050, seek: 1670, samples: 46562 },
  hole: { charId: 354, rate: 22050, seek: 1670, samples: 32867 },
  fanfare: { charId: 258, rate: 22050, seek: 1670, samples: 44800 },
  rebound: { charId: 457, rate: 22050, seek: 1670, samples: 23104 },
  speed: { charId: 464, rate: 22050, seek: 1670, samples: 20960 },
} as const satisfies Record<SoundId, SoundMeta>;
