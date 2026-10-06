import type { RendererName } from "@/app/GameMode.ts";
import type { AssetBundle } from "@/assets/AssetLoader.ts";
import type { AudioPlayer } from "@/audio/AudioPlayer.ts";
import type { Effects } from "@/render/effects/Effects.ts";
import type { Renderer, RendererOptions } from "@/render/Renderer.ts";

/*
 * The chunks boot fetches alongside the atlas. Each is a dynamic import, so it
 * lands in a Vite chunk of its own, and each is started before the atlas is
 * awaited so the downloads overlap. A chunk that fails is a game without that
 * part, said once on the console - except the Canvas2D backend where nothing
 * else can draw, whose failure is boot's.
 */

export type PixiModule = typeof import("@/render/PixiRenderer.ts");
export type CanvasModule = typeof import("@/render/GameRenderer.ts");
export type IntroModule = typeof import("@/app/intro.ts");

/**
 * Whether this browser can give us a WebGL context at all. Asked on a scratch
 * canvas, because asking the stage canvas would claim its context type.
 */
function webglAvailable(): boolean {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
  // Browsers cap live contexts at a handful; the probe's would otherwise hold
  // one of those slots until it was garbage-collected.
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}

/**
 * The player and its sound URLs, in a chunk of their own. A failure here is a
 * silent game, not a broken one, so it resolves to null instead of rejecting.
 * Its own chunk: every visitor pays for the eager bundle, and nothing can
 * sound before the first gesture anyway.
 */
export function startAudioImport(): Promise<AudioPlayer | null> {
  return Promise.all([import("@/audio/AudioPlayer.ts"), import("@/assets/SoundUrls.ts")])
    .then(([{ AudioPlayer: Player }, { SOUND_URLS }]) => new Player({ urls: SOUND_URLS }))
    .catch((error: unknown) => {
      console.warn("[hamsterflight] no sound: %o", error);
      return null;
    });
}

/**
 * Both backends are chunks of their own. Pixi is the default and every
 * visitor with WebGL draws with it, so the Canvas2D fallback is fetched only
 * where it will draw: started alongside the atlas when WebGL is out of the
 * question from the start, on the spot when Pixi fails to come up.
 */
export interface RendererImport {
  /** Null when Pixi is not wanted or cannot have a context; never rejects. */
  readonly pixi: Promise<PixiModule | null>;
  /** The Canvas2D backend, fetched the first time it is asked for. */
  readonly canvas: () => Promise<CanvasModule>;
}

/**
 * Started before the atlas is awaited, so the downloads overlap: the Pixi
 * chunk is 160 kB gzip and used to be requested only after the 2 MB sheet had
 * fully arrived. Pixi resolves to null when it is not wanted or the machine
 * cannot give it a context - a blocklisted GPU, WebGL disabled, a remote
 * desktop - and `pickRenderer` falls back to Canvas2D, which draws the same
 * scene without the shaders.
 */
export function startRendererImport(name: RendererName): RendererImport {
  const pixi = startPixiImport(name);
  let canvas: Promise<CanvasModule> | null = null;
  const loadCanvas = (): Promise<CanvasModule> => (canvas ??= import("@/render/GameRenderer.ts"));
  // A failure is reported where the module is awaited, in `pickRenderer`.
  void pixi.then((module) => {
    if (module === null) loadCanvas().catch(() => undefined);
  });
  return { pixi, canvas: loadCanvas };
}

function startPixiImport(name: RendererName): Promise<PixiModule | null> {
  if (name !== "pixi") return Promise.resolve(null);
  if (!webglAvailable()) {
    console.warn("[hamsterflight] no WebGL context available; using the canvas2d renderer");
    return Promise.resolve(null);
  }
  return import("@/render/PixiRenderer.ts").catch((error: unknown) => {
    console.warn("[hamsterflight] WebGL renderer failed to load; using canvas2d", error);
    return null;
  });
}

/**
 * The opening screen is a chunk of its own, fetched alongside the atlas: it
 * is shown once per visit and never at all under `?instructions=0`.
 */
export function startIntroImport(wanted: boolean): Promise<IntroModule | null> {
  if (!wanted) return Promise.resolve(null);
  return import("@/app/intro.ts").catch((error: unknown) => {
    console.warn("[hamsterflight] no opening screen: %o", error);
    return null;
  });
}

export async function pickRenderer(
  backends: RendererImport,
  canvas: HTMLCanvasElement,
  assets: AssetBundle,
  effects: Effects,
  options: RendererOptions,
): Promise<{ renderer: Renderer; backend: RendererName }> {
  const pixi = await backends.pixi;
  if (pixi !== null) {
    try {
      return {
        renderer: await pixi.createPixiRenderer(canvas, assets, effects, options),
        backend: "pixi",
      };
    } catch (error) {
      console.warn("[hamsterflight] WebGL renderer failed to start; using canvas2d", error);
    }
  }
  const { createCanvasRenderer } = await backends.canvas();
  return {
    renderer: await createCanvasRenderer(canvas, assets, effects, options),
    backend: "canvas2d",
  };
}
