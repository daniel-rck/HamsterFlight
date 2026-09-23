import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOUNDS } from "@/assets/sounds.generated.ts";

describe("sound files", () => {
  it("has an MP3 for every SoundId", () => {
    // The URL table maps a missing file to "", which only shows up in the
    // browser as a cue that never sounds.
    for (const id of Object.keys(SOUNDS)) {
      const path = new URL(`../../src/assets/sounds/${id}.mp3`, import.meta.url);
      expect(existsSync(path), id).toBe(true);
      expect(statSync(path).size, id).toBeGreaterThan(1000);
    }
  });
});
