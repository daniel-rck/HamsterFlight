/**
 * There is one game: the WebGL-backed presentation with its shaders and
 * particles. The Canvas2D renderer draws the same scene without the shaders and
 * is what a machine without WebGL gets; `?renderer=` forces either, which is
 * what the benchmark harness and the smoke test use to compare the two.
 */
export type RendererName = "pixi" | "canvas2d";

const RENDERERS: readonly RendererName[] = ["pixi", "canvas2d"];

function isRenderer(value: string): value is RendererName {
  return (RENDERERS as readonly string[]).includes(value);
}

/**
 * A documented control surface, so a typo is reported rather than silently
 * mapped onto a default that happens to be the wrong one.
 */
export function rendererFromUrl(
  params: URLSearchParams,
  warn: (message: string) => void = console.warn,
): RendererName {
  const raw = params.get("renderer");
  if (raw === null) return "pixi";
  if (isRenderer(raw)) return raw;
  warn(`[hamsterflight] unknown ?renderer=${raw}; expected ${RENDERERS.join(" | ")}. Using pixi.`);
  return "pixi";
}
