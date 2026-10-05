import {
  type AssetBundle,
  densityFor,
  type LoadProgress,
  loadSprites,
} from "@/assets/AssetLoader.ts";
import { elementScale } from "@/render/resolution.ts";

/*
 * The stage's size, and the atlas that suits it.
 */

/**
 * Re-fit the backing store when the stage changes size - a window drag, a
 * scrollbar appearing, a monitor with a different pixel ratio. Coalesced into
 * one call per frame: every `resize()` reallocates the canvas, and a drag
 * fires dozens of events a second.
 */
export function watchStageSize(
  canvas: HTMLCanvasElement,
  onChange: () => void,
  signal: AbortSignal,
): void {
  let pending = 0;
  const schedule = (): void => {
    if (pending !== 0) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      onChange();
    });
  };
  signal.addEventListener("abort", () => cancelAnimationFrame(pending));

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    signal.addEventListener("abort", () => observer.disconnect());
  } else {
    window.addEventListener("resize", schedule, { signal });
  }
  // A ratio change does not fire `resize`; ask the media query instead, and
  // re-arm it because the query is for the ratio we had, not the one we get.
  const watchRatio = (): void => {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      "change",
      () => {
        schedule();
        watchRatio();
      },
      { once: true, signal },
    );
  };
  if (typeof matchMedia === "function") watchRatio();
}

/**
 * The atlas for a stage at `scale`, or null when there is none to draw with.
 *
 * How big the stage actually is decides which atlas is worth downloading - a
 * 1x screen showing a wide layout is already past 1:1.
 */
export async function loadAtlas(
  scale: number,
  progress: (p: LoadProgress) => void,
): Promise<AssetBundle | null> {
  let assets = await loadSprites(progress, densityFor(scale));
  if (assets.missing.length > 0 && assets.density !== 1) {
    // The denser sheet is the larger download and the likelier one to fail;
    // the 1x sheet draws the same game, only softer.
    console.warn("[hamsterflight] %s; retrying at 1x", assets.missing.join(", "));
    assets = await loadSprites(progress, 1);
  }
  if (assets.missing.length > 0) {
    // One sheet holds every sprite, so a missing sheet is not a degraded game
    // but an invisible one: sky and HUD, no hamster, clicks that seem to do
    // nothing. The caller says so instead of starting it.
    console.error("[hamsterflight] sprite sheets missing: %s", assets.missing.join(", "));
    return null;
  }
  return assets;
}

/**
 * The atlas was picked for the stage as it was at boot. A stage that grows
 * past it - full screen, a larger window, a sharper monitor - fetches the
 * denser sheet once, in the background, and hands it to `swap`; a failure
 * keeps the softer one, which draws the same game, and is not retried.
 *
 * Returns the check to run whenever the stage may have grown.
 */
export function atlasUpgrade(
  canvas: HTMLCanvasElement,
  current: AssetBundle,
  swap: (denser: AssetBundle) => void,
  signal: AbortSignal,
): () => void {
  let density = current.density;
  let upgrading = false;
  return () => {
    const wanted = densityFor(elementScale(canvas));
    if (upgrading || wanted <= density) return;
    upgrading = true;
    void loadSprites(undefined, wanted).then((denser) => {
      if (signal.aborted) return;
      if (denser.missing.length > 0) {
        console.warn("[hamsterflight] denser atlas unavailable: %s", denser.missing.join(", "));
        return;
      }
      density = denser.density;
      swap(denser);
      upgrading = false;
    });
  };
}
