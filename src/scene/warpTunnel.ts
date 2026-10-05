import type { Rng } from '../game/random';

interface Streak {
  angle: number;
  /** 0 at the centre, 1 at the edge. */
  radius: number;
  speed: number;
  width: number;
  hue: number;
}

const STREAK_COUNT = 260;

/**
 * Full-screen hyperspace tunnel drawn on a 2D canvas: star streaks racing
 * outward from the centre over a deep blue field, with a bright core. The
 * overlay's opacity is driven from outside so it can fade in and out.
 */
export class WarpTunnel {
  readonly canvas: HTMLCanvasElement;
  private readonly streaks: Streak[] = [];
  private width = 1;
  private height = 1;
  private opacity = 0;

  constructor(private readonly rng: Rng) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'warp-tunnel';
    this.canvas.style.opacity = '0';
    this.canvas.style.display = 'none';
    for (let i = 0; i < STREAK_COUNT; i++) this.streaks.push(this.freshStreak(this.rng()));
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width * pixelRatio));
    this.height = Math.max(1, Math.floor(height * pixelRatio));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  /** `opacity` fades the whole overlay; `intensity` sets streak speed and length. */
  update(dt: number, opacity: number, intensity: number): void {
    const visible = opacity > 0.001;
    if (visible !== this.opacity > 0.001) this.canvas.style.display = visible ? 'block' : 'none';
    this.opacity = opacity;
    this.canvas.style.opacity = opacity.toFixed(3);
    if (!visible) return;

    const context = this.canvas.getContext('2d');
    if (!context) return;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const reach = Math.hypot(cx, cy);

    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#04060f';
    context.fillRect(0, 0, this.width, this.height);
    const field = context.createRadialGradient(cx, cy, 0, cx, cy, reach);
    field.addColorStop(0, `rgba(120, 180, 255, ${0.35 + 0.45 * intensity})`);
    field.addColorStop(0.25, `rgba(40, 70, 160, ${0.25 + 0.25 * intensity})`);
    field.addColorStop(1, 'rgba(4, 6, 15, 0)');
    context.fillStyle = field;
    context.fillRect(0, 0, this.width, this.height);

    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    const scale = this.width / 1400;
    for (const streak of this.streaks) {
      streak.radius += streak.speed * dt * (0.15 + 1.6 * intensity) * (0.3 + streak.radius);
      if (streak.radius > 1.15) Object.assign(streak, this.freshStreak(0.02 + this.rng() * 0.08));
      const length = (0.04 + 0.35 * intensity) * streak.radius * (0.6 + streak.speed);
      const r0 = Math.max(0, streak.radius - length) * reach;
      const r1 = streak.radius * reach;
      const x0 = cx + Math.cos(streak.angle) * r0;
      const y0 = cy + Math.sin(streak.angle) * r0;
      const x1 = cx + Math.cos(streak.angle) * r1;
      const y1 = cy + Math.sin(streak.angle) * r1;
      const gradient = context.createLinearGradient(x0, y0, x1, y1);
      const alpha = Math.min(1, 0.15 + streak.radius * 1.2) * (0.5 + 0.5 * intensity);
      gradient.addColorStop(0, `hsla(${streak.hue}, 90%, 80%, 0)`);
      gradient.addColorStop(1, `hsla(${streak.hue}, 90%, 85%, ${alpha})`);
      context.strokeStyle = gradient;
      context.lineWidth = streak.width * scale * (0.6 + streak.radius);
      context.beginPath();
      context.moveTo(x0, y0);
      context.lineTo(x1, y1);
      context.stroke();
    }

    // Hot core.
    const core = context.createRadialGradient(cx, cy, 0, cx, cy, reach * (0.08 + 0.1 * intensity));
    core.addColorStop(0, `rgba(255, 255, 255, ${0.7 + 0.3 * intensity})`);
    core.addColorStop(0.5, `rgba(170, 215, 255, ${0.35 * intensity})`);
    core.addColorStop(1, 'rgba(170, 215, 255, 0)');
    context.fillStyle = core;
    context.fillRect(0, 0, this.width, this.height);
  }

  dispose(): void {
    this.canvas.remove();
  }

  private freshStreak(radius: number): Streak {
    return {
      angle: this.rng() * Math.PI * 2,
      radius,
      speed: 0.4 + this.rng() * 1.2,
      width: 1 + this.rng() * 2.2,
      hue: this.rng() < 0.75 ? 205 + this.rng() * 25 : 265 + this.rng() * 30,
    };
  }
}
