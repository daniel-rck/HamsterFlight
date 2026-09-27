import type { InputCommand } from "@/sim/commands.ts";

/**
 * One game's input, as the simulation received it: a seed and the commands
 * handed to each `step()`. Replaying it into a fresh `Simulation` reproduces
 * the game exactly - that is what the ghost, the daily best and a shared link
 * are made of.
 *
 * Keyed by step, not by sim tick. A step while paused does not advance the
 * tick but can still carry commands (a release, the resuming press), and
 * replaying those by tick would mean re-deriving the pause rules here. The one
 * thing left out is a step that is both paused and empty: the sim returns from
 * it without touching anything, so dropping it cannot change the replay, and
 * a game left paused for an hour does not become an hour of steps to replay.
 */
export interface Run {
  readonly seed: number;
  /** Steps with commands, in order; `step` counts every step that was recorded. */
  readonly entries: readonly RunEntry[];
  /** The step on which the game ended - the one whose events carried `gameOver`. */
  readonly endStep: number;
}

export interface RunEntry {
  readonly step: number;
  readonly commands: readonly InputCommand[];
}

/** Bumped whenever the encoding changes. A physics change needs no bump: the
 *  replay checks that the game still ends where the recording says it did. */
const FORMAT = 1;

/**
 * About 83 minutes of unpaused play. A link is untrusted input, and replaying
 * it runs the simulation that many times on the reader's machine.
 */
export const MAX_RUN_STEPS = 100_000;

const CODES: readonly InputCommand["kind"][] = [
  "press",
  "release",
  "confirm",
  "togglePause",
  "pause",
];

export class RunRecorder {
  readonly seed: number;
  #step = 0;
  #entries: RunEntry[] = [];
  #endStep: number | null = null;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * Call once per `step()`, before it, with what is about to be passed in and
   * whether the snapshot the commands were read against was paused.
   */
  record(commands: readonly InputCommand[], paused: boolean): void {
    if (this.#endStep !== null) return;
    if (paused && commands.length === 0) return;
    if (commands.length > 0) this.#entries.push({ step: this.#step, commands: [...commands] });
    this.#step++;
  }

  /** The step just recorded ended the game. */
  finish(): void {
    if (this.#endStep === null) this.#endStep = this.#step - 1;
  }

  /** The finished game, or null while it is still being played. */
  run(): Run | null {
    if (this.#endStep === null) return null;
    return { seed: this.seed, entries: this.#entries, endStep: this.#endStep };
  }
}

// -- encoding ------------------------------------------------------------------

/**
 * `[format, seed, endStep, token...]` as unsigned LEB128 varints, then
 * base64url - short enough for a URL. A token is `(stepDelta << 3) | code`, one
 * per command; commands sharing a step have a delta of 0. A game of five shots
 * with a busy glide finger is a few hundred bytes.
 */
export function encodeRun(run: Run): string {
  const bytes: number[] = [];
  writeVarint(bytes, FORMAT);
  writeVarint(bytes, run.seed >>> 0);
  writeVarint(bytes, run.endStep);
  let last = 0;
  for (const entry of run.entries) {
    for (const [i, command] of entry.commands.entries()) {
      const delta = i === 0 ? entry.step - last : 0;
      writeVarint(bytes, delta * 8 + CODES.indexOf(command.kind));
    }
    last = entry.step;
  }
  return toBase64Url(bytes);
}

/** The run in `text`, or null for anything that is not one - it comes from a URL. */
export function decodeRun(text: string): Run | null {
  const bytes = fromBase64Url(text);
  if (bytes === null) return null;
  const reader = { bytes, at: 0 };
  const format = readVarint(reader);
  const seed = readVarint(reader);
  const endStep = readVarint(reader);
  if (format !== FORMAT || seed === null || seed > 0xffffffff || endStep === null) return null;
  if (endStep > MAX_RUN_STEPS) return null;

  const entries: { step: number; commands: InputCommand[] }[] = [];
  let step = 0;
  while (reader.at < bytes.length) {
    const token = readVarint(reader);
    if (token === null) return null;
    const kind = CODES[token % 8];
    if (kind === undefined) return null;
    const delta = Math.floor(token / 8);
    const previous = entries[entries.length - 1];
    if (previous === undefined || delta > 0) {
      step += delta;
      if (step > endStep) return null;
      entries.push({ step, commands: [{ kind }] });
    } else {
      previous.commands.push({ kind });
    }
  }
  return { seed, entries, endStep };
}

function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function readVarint(reader: { bytes: Uint8Array; at: number }): number | null {
  let value = 0;
  let scale = 1;
  // Five bytes carry 35 bits, past every number this format holds.
  for (let i = 0; i < 5; i++) {
    const byte = reader.bytes[reader.at++];
    if (byte === undefined) return null;
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return value;
    scale *= 0x80;
  }
  return null;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    if (b !== undefined) out += ALPHABET[(n >> 6) & 63];
    if (c !== undefined) out += ALPHABET[n & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 4 === 1) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) return null;
    buffer = ((buffer << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
