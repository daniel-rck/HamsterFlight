/**
 * `enhanced` is what a visitor gets: the polished game, WebGL-backed so it can
 * carry shaders and particle effects. `faithful` is the reference - the
 * Canvas2D renderer drawing exactly what the original Flash stage drew, with
 * nothing added - and stays reachable through `?mode=faithful`.
 *
 * The mode picks a default backend, it does not force one: `?renderer=` still
 * overrides, which is what the benchmark harness uses to compare the two.
 */
export type GameMode = 'enhanced' | 'faithful';

export type RendererName = 'pixi' | 'canvas2d';

export function modeFromUrl(params: URLSearchParams): GameMode {
  return params.get('mode') === 'faithful' ? 'faithful' : 'enhanced';
}

export function defaultRendererFor(mode: GameMode): RendererName {
  return mode === 'enhanced' ? 'pixi' : 'canvas2d';
}
