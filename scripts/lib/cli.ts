import { fileURLToPath } from "node:url";

/** The repository root, so every script works from any working directory. */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * An integer from the environment, or the fallback. `Number('abc')` is `NaN`
 * and used to sail straight into a URL as `?seed=NaN`; this refuses instead.
 */
export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(`${name}=${raw} is not an integer`);
  }
  return parsed;
}

/** A comma-separated list of integers from the environment. */
export function intListEnv(name: string, fallback: readonly number[]): readonly number[] {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.split(",").map((part) => {
    const parsed = Number.parseInt(part, 10);
    if (!Number.isFinite(parsed)) throw new Error(`${name}=${raw} has a non-integer entry`);
    return parsed;
  });
}

/** True when this module is the one Node was asked to run, as opposed to imported. */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && fileURLToPath(moduleUrl) === entry;
}

/** Run a script's main, turning a rejection into an exit code rather than a stack dump. */
export function run(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
