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

const MODES: readonly GameMode[] = ['enhanced', 'faithful'];
const RENDERERS: readonly RendererName[] = ['pixi', 'canvas2d'];

function isMode(value: string): value is GameMode {
  return (MODES as readonly string[]).includes(value);
}

function isRenderer(value: string): value is RendererName {
  return (RENDERERS as readonly string[]).includes(value);
}

/**
 * These are the documented control surface, so a typo is reported rather than
 * silently mapped onto a default that happens to be the wrong one.
 */
export function modeFromUrl(
  params: URLSearchParams,
  warn: (message: string) => void = console.warn,
): GameMode {
  const raw = params.get('mode');
  if (raw === null) return 'enhanced';
  if (isMode(raw)) return raw;
  warn(`[hamsterflight] unknown ?mode=${raw}; expected ${MODES.join(' | ')}. Using enhanced.`);
  return 'enhanced';
}

export function rendererFromUrl(
  params: URLSearchParams,
  mode: GameMode,
  warn: (message: string) => void = console.warn,
): RendererName {
  const raw = params.get('renderer');
  if (raw === null) return defaultRendererFor(mode);
  if (isRenderer(raw)) return raw;
  warn(
    `[hamsterflight] unknown ?renderer=${raw}; expected ${RENDERERS.join(' | ')}. Using the mode's default.`,
  );
  return defaultRendererFor(mode);
}

export function defaultRendererFor(mode: GameMode): RendererName {
  return mode === 'enhanced' ? 'pixi' : 'canvas2d';
}
