import type { MapIconName } from '../game/map';

/**
 * Old-school minimap icons drawn with canvas paths, so they stay crisp at
 * any size and need no art files. Each glyph is drawn centred on (x, y)
 * inside a dark round badge `size` pixels across.
 */
export const ICON_COLOURS: Readonly<Record<MapIconName, string>> = {
  home: '#ffd27a',
  mine: '#c9b59a',
  crystal: '#c9a6ff',
  skull: '#ff6b6b',
  shop: '#ffcf4a',
  repair: '#9fd0ff',
  quest: '#ffe066',
  flag: '#6fd3ff',
  star: '#fff1a8',
  gate: '#6fd3ff',
  fuel: '#8affb0',
  anchor: '#d8e0ea',
};

export function drawMapIcon(context: CanvasRenderingContext2D, icon: MapIconName, x: number, y: number, size: number, colour: string | null): void {
  const c = colour ?? ICON_COLOURS[icon];
  const r = size / 2;
  context.save();
  context.translate(x, y);
  // Badge.
  context.fillStyle = 'rgba(8, 10, 16, 0.88)';
  context.beginPath();
  context.arc(0, 0, r, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(200, 208, 220, 0.35)';
  context.lineWidth = 1;
  context.stroke();
  // Glyph in a unit space of about -1..1 scaled to the badge.
  const g = r * 0.62;
  context.scale(g, g);
  context.lineWidth = 0.28;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = c;
  context.fillStyle = c;
  GLYPHS[icon](context);
  context.restore();
}

const GLYPHS: Readonly<Record<MapIconName, (context: CanvasRenderingContext2D) => void>> = {
  home: (c) => {
    c.beginPath();
    c.moveTo(-1, 0.1);
    c.lineTo(0, -0.95);
    c.lineTo(1, 0.1);
    c.stroke();
    c.fillRect(-0.62, 0.05, 1.24, 0.85);
    c.clearRect(-0.18, 0.4, 0.36, 0.5);
    c.fillStyle = 'rgba(8, 10, 16, 0.95)';
    c.fillRect(-0.18, 0.4, 0.36, 0.5);
  },
  mine: (c) => {
    // Pickaxe: handle and curved head.
    c.beginPath();
    c.moveTo(-0.75, 0.85);
    c.lineTo(0.45, -0.35);
    c.stroke();
    c.lineWidth = 0.34;
    c.beginPath();
    c.moveTo(-0.3, -0.75);
    c.quadraticCurveTo(0.55, -0.95, 0.95, -0.1);
    c.stroke();
  },
  crystal: (c) => {
    c.beginPath();
    c.moveTo(0, -1);
    c.lineTo(0.75, -0.25);
    c.lineTo(0.45, 0.9);
    c.lineTo(-0.45, 0.9);
    c.lineTo(-0.75, -0.25);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 0.14;
    c.beginPath();
    c.moveTo(-0.75, -0.25);
    c.lineTo(0.75, -0.25);
    c.moveTo(0, -1);
    c.lineTo(0, 0.9);
    c.stroke();
  },
  skull: (c) => {
    c.beginPath();
    c.arc(0, -0.2, 0.75, Math.PI, 0);
    c.lineTo(0.75, 0.25);
    c.quadraticCurveTo(0.75, 0.6, 0.4, 0.6);
    c.lineTo(0.4, 0.95);
    c.lineTo(-0.4, 0.95);
    c.lineTo(-0.4, 0.6);
    c.quadraticCurveTo(-0.75, 0.6, -0.75, 0.25);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(8, 10, 16, 0.95)';
    c.beginPath();
    c.arc(-0.3, -0.15, 0.22, 0, Math.PI * 2);
    c.arc(0.3, -0.15, 0.22, 0, Math.PI * 2);
    c.fill();
    c.fillRect(-0.08, 0.2, 0.16, 0.25);
  },
  shop: (c) => {
    // Money bag.
    c.beginPath();
    c.moveTo(-0.3, -0.95);
    c.lineTo(0.3, -0.95);
    c.lineTo(0.15, -0.55);
    c.quadraticCurveTo(1, -0.1, 0.8, 0.7);
    c.quadraticCurveTo(0.6, 1, 0, 1);
    c.quadraticCurveTo(-0.6, 1, -0.8, 0.7);
    c.quadraticCurveTo(-1, -0.1, -0.15, -0.55);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(8, 10, 16, 0.95)';
    c.lineWidth = 0.16;
    c.beginPath();
    c.moveTo(-0.25, 0.15);
    c.lineTo(0.25, 0.15);
    c.moveTo(0, -0.1);
    c.lineTo(0, 0.55);
    c.stroke();
  },
  repair: (c) => {
    // Wrench.
    c.lineWidth = 0.36;
    c.beginPath();
    c.moveTo(-0.75, 0.75);
    c.lineTo(0.2, -0.2);
    c.stroke();
    c.beginPath();
    c.arc(0.45, -0.45, 0.5, Math.PI * 0.15, Math.PI * 1.35);
    c.lineWidth = 0.3;
    c.stroke();
  },
  quest: (c) => {
    c.lineWidth = 0.36;
    c.beginPath();
    c.moveTo(0, -0.95);
    c.lineTo(0, 0.3);
    c.stroke();
    c.beginPath();
    c.arc(0, 0.78, 0.2, 0, Math.PI * 2);
    c.fill();
  },
  flag: (c) => {
    c.beginPath();
    c.moveTo(-0.6, -1);
    c.lineTo(-0.6, 1);
    c.stroke();
    c.beginPath();
    c.moveTo(-0.6, -0.95);
    c.lineTo(0.8, -0.5);
    c.lineTo(-0.6, -0.05);
    c.closePath();
    c.fill();
  },
  star: (c) => {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? 1 : 0.45;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      c.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    c.closePath();
    c.fill();
  },
  gate: (c) => {
    c.lineWidth = 0.32;
    c.beginPath();
    c.moveTo(-0.75, 0.95);
    c.lineTo(-0.75, -0.1);
    c.arc(0, -0.1, 0.75, Math.PI, 0);
    c.lineTo(0.75, 0.95);
    c.stroke();
  },
  fuel: (c) => {
    c.beginPath();
    c.moveTo(0, -1);
    c.quadraticCurveTo(0.9, 0.2, 0.55, 0.65);
    c.quadraticCurveTo(0, 1.2, -0.55, 0.65);
    c.quadraticCurveTo(-0.9, 0.2, 0, -1);
    c.closePath();
    c.fill();
  },
  anchor: (c) => {
    c.beginPath();
    c.arc(0, -0.7, 0.22, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(0, -0.48);
    c.lineTo(0, 0.95);
    c.moveTo(-0.45, -0.15);
    c.lineTo(0.45, -0.15);
    c.stroke();
    c.beginPath();
    c.arc(0, 0.2, 0.75, Math.PI * 0.15, Math.PI * 0.85);
    c.stroke();
  },
};
