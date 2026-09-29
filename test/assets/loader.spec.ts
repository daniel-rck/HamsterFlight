import { afterEach, describe, expect, it, vi } from "vitest";
import { type LoadProgress, loadSprites } from "@/assets/AssetLoader.ts";

/** A response that streams `size` bytes in `parts` chunks, announcing its length or not. */
function streamed(size: number, parts: number, announce: boolean): Response {
  const chunk = new Uint8Array(size / parts);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === parts) {
        controller.close();
        return;
      }
      sent++;
      controller.enqueue(chunk);
    },
  });
  const headers: Record<string, string> = { "content-type": "image/png" };
  if (announce) headers["content-length"] = String(size);
  return new Response(body, { status: 200, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSprites progress", () => {
  it("reports the atlas download by bytes as they arrive", async () => {
    vi.stubGlobal("fetch", async () => streamed(4000, 4, true));
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1 }));
    const seen: LoadProgress[] = [];
    const bundle = await loadSprites((p) => seen.push(p));
    expect(bundle.missing).toEqual([]);
    const fractions = seen.map((p) => p.fraction);
    expect(fractions[0]).toBe(0);
    expect(fractions).toContain(0.5);
    expect(fractions.at(-1)).toBe(1);
    // Never backwards.
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i] ?? 0).toBeGreaterThanOrEqual(fractions[i - 1] ?? 0);
    }
  });

  it("says it does not know until the end when the size is not announced", async () => {
    vi.stubGlobal("fetch", async () => streamed(4000, 4, false));
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1 }));
    const seen: LoadProgress[] = [];
    await loadSprites((p) => seen.push(p));
    expect(seen.map((p) => p.fraction)).toEqual([1]);
  });

  it("records a failed sheet as missing rather than throwing", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404, statusText: "Nope" }));
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1 }));
    const bundle = await loadSprites();
    expect(bundle.missing).toHaveLength(1);
    expect(bundle.get("pillow")).toBeUndefined();
  });
});
