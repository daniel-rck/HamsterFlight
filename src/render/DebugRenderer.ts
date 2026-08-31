import { C, type SimSnapshot } from '@/sim/index.ts';
import { DEFAULT_TUNING } from '@/sim/tuning.ts';

const VIEW_W = 600;
const VIEW_H = 400;

const POWERUP_COLOURS: Record<string, string> = {
  bounce: '#7ee081',
  speed: '#ffd166',
  wind: '#8ecae6',
  slide: '#c77dff',
  rebound: '#ff7b7b',
  superbounce: '#ff9f1c',
};

/**
 * Deliberately geometric: boxes, lines and readouts drawn from the real
 * hitboxes. Its job is to make the simulation visible and playable before any
 * art exists, and to stay useful afterwards as a `?debug` overlay.
 *
 * It reads a snapshot and nothing else - it cannot reach the simulation, so it
 * cannot influence physics.
 */
export class DebugRenderer {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #canvas: HTMLCanvasElement;
  #dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('2D canvas context unavailable');
    this.#ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#canvas.width = Math.round(VIEW_W * this.#dpr);
    this.#canvas.height = Math.round(VIEW_H * this.#dpr);
  }

  draw(s: SimSnapshot): void {
    const ctx = this.#ctx;
    const d = this.#dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);

    // Sky darkens with altitude; space is reachable at y = -4790.
    const altitude = Math.min(Math.max((C.GROUND_Y - s.hamster.y) / 2000, 0), 1);
    ctx.fillStyle = `rgb(${Math.round(120 - 110 * altitude)}, ${Math.round(
      180 - 170 * altitude,
    )}, ${Math.round(225 - 180 * altitude)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // World space: the camera offsets are the original's negative container
    // offsets, so they apply directly as a translation.
    ctx.save();
    ctx.setTransform(d, 0, 0, d, s.camera.x * d, s.camera.y * d);

    this.#ground(ctx);
    this.#powerups(ctx, s);
    if (s.hamster.visible) this.#hamster(ctx, s);

    ctx.restore();
    this.#hud(ctx, s);
  }

  #ground(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#4a7c3f';
    ctx.fillRect(-5000, C.GROUND_Y, 200000, 400);
    ctx.strokeStyle = '#2f5228';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5000, C.GROUND_Y);
    ctx.lineTo(195000, C.GROUND_Y);
    ctx.stroke();

    // Distance markers every 10 ft.
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '11px ui-monospace, monospace';
    for (let feet = 0; feet <= 2000; feet += 10) {
      const x = feet * C.PX_PER_FOOT;
      ctx.fillRect(x, C.GROUND_Y - 8, 1, 8);
      if (feet % 50 === 0) ctx.fillText(`${feet}ft`, x + 3, C.GROUND_Y - 12);
    }

    // The pillow, and the launch pad.
    const pillow = DEFAULT_TUNING.boxes.pillow;
    ctx.fillStyle = '#f4f1de';
    ctx.fillRect(
      C.PILLOW_LAUNCH_X + pillow.cx - pillow.hw,
      C.PILLOW_Y + pillow.cy - pillow.hh,
      pillow.hw * 2,
      pillow.hh * 2,
    );
  }

  #powerups(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    for (const it of s.powerups) {
      const box = DEFAULT_TUNING.boxes.powerups[it.kind];
      ctx.globalAlpha = it.taken ? 0.22 : 1;
      ctx.fillStyle = POWERUP_COLOURS[it.kind] ?? '#fff';
      ctx.fillRect(it.x + box.cx - box.hw, it.y + box.cy - box.hh, box.hw * 2, box.hh * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(it.kind.slice(0, 5), it.x + box.cx - box.hw, it.y + box.cy - box.hh - 3);
    }
  }

  #hamster(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    const flying = s.phaseKind === 'flying';
    const box = flying
      ? DEFAULT_TUNING.boxes.hamsterFlightCore
      : DEFAULT_TUNING.boxes.hamsterJumpCore;
    const h = s.hamster;

    // Shadow: scales linearly with height, 100 * (y - 700) / 263.
    const shadowScale = Math.max(0, (100 * (h.y - 700)) / 263) / 100;
    if (shadowScale > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath();
      ctx.ellipse(h.x, 963, 27.55 * shadowScale, 3.85 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(h.x + box.cx, h.y + box.cy);
    if (flying && h.doRotation) {
      ctx.rotate(Math.atan2(h.yvel, h.xvel) + Math.PI / 2);
    }
    ctx.fillStyle = s.flags.glide ? '#ffe66d' : '#d9a066';
    ctx.fillRect(-box.hw, -box.hh, box.hw * 2, box.hh * 2);
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 2;
    ctx.strokeRect(-box.hw, -box.hh, box.hw * 2, box.hh * 2);
    // Nose, so orientation is readable.
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(-3, -box.hh - 5, 6, 6);
    ctx.restore();
  }

  #hud(ctx: CanvasRenderingContext2D, s: SimSnapshot): void {
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.font = '12px ui-monospace, monospace';

    // Glide meter.
    const w = 120;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(VIEW_W - w - 14, 10, w, 14);
    ctx.fillStyle = s.glidePoints > 0 ? '#ffe66d' : '#ff6b6b';
    ctx.fillRect(VIEW_W - w - 12, 12, (w - 4) * (s.glidePoints / C.GLIDE_MAX), 10);
    ctx.fillStyle = '#fff';
    ctx.fillText('glide', VIEW_W - w - 52, 22);

    const active = Object.entries(s.flags)
      .filter(([, on]) => on)
      .map(([name]) => name);

    const lines = [
      `turn ${Math.min(s.turn, C.TURNS)}/${C.TURNS}   ${s.feet} ft`,
      `x ${s.hamster.x.toFixed(1)}  y ${s.hamster.y.toFixed(1)}`,
      `xvel ${s.hamster.xvel.toFixed(2)}  yvel ${s.hamster.yvel.toFixed(2)}`,
      `tick ${s.tick}  ${s.phaseKind}${active.length > 0 ? `  [${active.join(' ')}]` : ''}`,
      `total ${s.shots.reduce((a, b) => a + b, 0)} ft   shots ${s.shots.join(', ') || '-'}`,
    ];
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(8, 8, 300, 16 * lines.length + 8);
    ctx.fillStyle = '#eaf6ff';
    for (const [i, line] of lines.entries()) {
      ctx.fillText(line, 14, 24 + i * 16);
    }

    const prompt = this.#prompt(s);
    if (prompt !== null) {
      ctx.font = 'bold 18px system-ui, sans-serif';
      const width = ctx.measureText(prompt).width;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect((VIEW_W - width) / 2 - 14, VIEW_H - 62, width + 28, 34);
      ctx.fillStyle = '#fff';
      ctx.fillText(prompt, (VIEW_W - width) / 2, VIEW_H - 38);
    }
  }

  #prompt(s: SimSnapshot): string | null {
    if (s.paused) return 'paused - P to resume';
    switch (s.phaseKind) {
      case 'ready':
        return 'click to jump';
      case 'jumping':
        return 'click again to hit the pillow';
      case 'flying':
        return s.flags.skidding ? 'skidding' : 'hold to glide';
      case 'gameOver':
        return `game over - ${s.shots.reduce((a, b) => a + b, 0)} ft total - click to restart`;
      default:
        return null;
    }
  }
}
