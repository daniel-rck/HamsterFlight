import type { SoundId } from "@/sim/events.ts";
import { SOUNDS } from "./sounds.generated.ts";

/**
 * Like the atlas sheets: Vite resolves the glob at build time, so every sound
 * gets a content-hashed URL under /assets/ and is cached immutably. The keys
 * come back as './sounds/fly.mp3'. A SoundId without a file is caught by
 * test/audio/sound-files.spec.ts rather than here, where it would only show
 * up as a silent cue.
 */
const FILES = import.meta.glob<string>("./sounds/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
});

export const SOUND_URLS = Object.fromEntries(
  (Object.keys(SOUNDS) as SoundId[]).map((id) => [id, FILES[`./sounds/${id}.mp3`] ?? ""]),
) as Record<SoundId, string>;
