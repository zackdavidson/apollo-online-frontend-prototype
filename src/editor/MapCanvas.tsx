import { useEffect, useRef } from 'react';
import type { MapDefinition } from '../game/map';
import { headingBearing } from '../game/mapCoords';
import { ROCK_KINDS } from '../game/rocks';
import { drawMapIcon } from '../hud/mapIcons';
import { hitTest, positionOf, type Point, type Selection } from './mapDocument';

export interface MapCanvasProps {
  readonly map: MapDefinition;
  readonly selection: Selection | null;
  /** True when a click should select and drag rather than place. */
  readonly selecting: boolean;
  /** 'overview': a minimap whose clicks only ask the 3D view to look there. */
  readonly mode?: 'edit' | 'overview';
  readonly onJump?: (point: Point) => void;
  /** Where the 3D view is looking, for the overview's crosshair. */
  readonly focus?: Point | null;
  /** A placement tool's click, in map coordinates. */
  readonly onPlace: (x: number, y: number) => void;
  readonly onSelect: (selection: Selection | null) => void;
  readonly onDragStart: () => void;
  readonly onDrag: (selection: Selection, x: number, y: number) => void;
  readonly onDragEnd: () => void;
  readonly onHover: (point: Point | null) => void;
}

interface View {
  /** Map coordinates of the canvas's bottom-left corner. */
  x: number;
  y: number;
  /** Pixels per map unit. */
  scale: number;
}

const GRID_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const MIN_SCALE = 0.02;
const MAX_SCALE = 40;

/**
 * The editor's map view: a 2D canvas in map coordinates (y up), panned
 * with the right or middle button and zoomed with the wheel about the
 * cursor. Drawing is imperative; React only owns the inputs.
 */
export function MapCanvas({ map, selection, selecting, mode = 'edit', onJump, focus = null, onPlace, onSelect, onDragStart, onDrag, onDragEnd, onHover }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ x: 0, y: 0, scale: 1 });
  const fittedSize = useRef(0);
  const latest = useRef({ map, selection, selecting, mode, onJump, focus, onPlace, onSelect, onDragStart, onDrag, onDragEnd, onHover });
  latest.current = { map, selection, selecting, mode, onJump, focus, onPlace, onSelect, onDragStart, onDrag, onDragEnd, onHover };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const size = (): { w: number; h: number } => ({ w: canvas.clientWidth, h: canvas.clientHeight });
    const toMap = (sx: number, sy: number): Point => {
      const { h } = size();
      const v = view.current;
      return { x: v.x + sx / v.scale, y: v.y + (h - sy) / v.scale };
    };
    const fit = (): void => {
      const { w, h } = size();
      const current = latest.current.map;
      const scale = Math.max(MIN_SCALE, (Math.min(w, h) * 0.86) / current.size);
      view.current = { scale, x: (current.size - w / scale) / 2, y: (current.size - h / scale) / 2 };
      fittedSize.current = current.size;
    };
    const redraw = (): void => {
      const { w, h } = size();
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (latest.current.map.size !== fittedSize.current) fit();
      draw(context, w, h, latest.current.map, latest.current.selection, view.current, latest.current.focus);
    };
    (canvas as HTMLCanvasElement & { __redraw?: () => void }).__redraw = redraw;

    let panning: { sx: number; sy: number; vx: number; vy: number } | null = null;
    let dragging: { selection: Selection; dx: number; dy: number } | null = null;

    const onPointerDown = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      canvas.setPointerCapture(event.pointerId);
      if (event.button === 1 || event.button === 2) {
        panning = { sx, sy, vx: view.current.x, vy: view.current.y };
        return;
      }
      if (event.button !== 0) return;
      const point = toMap(sx, sy);
      const state = latest.current;
      if (state.mode === 'overview') {
        state.onJump?.(point);
        return;
      }
      if (!state.selecting) {
        state.onPlace(point.x, point.y);
        return;
      }
      const hit = hitTest(state.map, point.x, point.y, 8 / view.current.scale);
      state.onSelect(hit);
      if (hit) {
        const at = positionOf(state.map, hit);
        if (at) {
          dragging = { selection: hit, dx: at.x - point.x, dy: at.y - point.y };
          state.onDragStart();
        }
      }
    };
    const onPointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      if (panning) {
        view.current.x = panning.vx - (sx - panning.sx) / view.current.scale;
        view.current.y = panning.vy + (sy - panning.sy) / view.current.scale;
        redraw();
        return;
      }
      const point = toMap(sx, sy);
      latest.current.onHover(point);
      if (dragging) latest.current.onDrag(dragging.selection, point.x + dragging.dx, point.y + dragging.dy);
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      panning = null;
      if (dragging) {
        dragging = null;
        latest.current.onDragEnd();
      }
    };
    const onPointerLeave = (): void => latest.current.onHover(null);
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const before = toMap(sx, sy);
      const v = view.current;
      v.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-event.deltaY * 0.0015)));
      const { h } = size();
      v.x = before.x - sx / v.scale;
      v.y = before.y - (h - sy) / v.scale;
      redraw();
    };
    const onContextMenu = (event: Event): void => event.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    const observer = new ResizeObserver(() => redraw());
    observer.observe(canvas);
    fit();
    redraw();
    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Any change to the document or selection repaints; pan and zoom repaint on their own.
  useEffect(() => {
    (canvasRef.current as (HTMLCanvasElement & { __redraw?: () => void }) | null)?.__redraw?.();
  }, [map, selection, focus]);

  return <canvas ref={canvasRef} className={`map-editor-canvas${selecting || mode === 'overview' ? '' : ' placing'}`} />;
}

function gridStep(scale: number): number {
  return GRID_STEPS.find((step) => step * scale >= 48) ?? GRID_STEPS[GRID_STEPS.length - 1]!;
}

function draw(context: CanvasRenderingContext2D, w: number, h: number, map: MapDefinition, selection: Selection | null, view: View, focus: Point | null): void {
  const sx = (x: number): number => (x - view.x) * view.scale;
  const sy = (y: number): number => h - (y - view.y) * view.scale;

  context.fillStyle = '#06080e';
  context.fillRect(0, 0, w, h);

  // The sector square and its grid.
  const side = map.size * view.scale;
  context.fillStyle = '#0c111d';
  context.fillRect(sx(0), sy(map.size), side, side);
  const step = gridStep(view.scale);
  context.lineWidth = 1;
  context.font = '10px ui-monospace, Menlo, monospace';
  context.textBaseline = 'middle';
  for (let value = 0; value <= map.size; value += step) {
    const major = value % (step * 5) === 0;
    context.strokeStyle = major ? 'rgba(120, 140, 170, 0.28)' : 'rgba(120, 140, 170, 0.12)';
    context.beginPath();
    context.moveTo(sx(value), sy(0));
    context.lineTo(sx(value), sy(map.size));
    context.moveTo(sx(0), sy(value));
    context.lineTo(sx(map.size), sy(value));
    context.stroke();
    if (major) {
      context.fillStyle = 'rgba(160, 180, 210, 0.7)';
      context.textAlign = 'center';
      context.fillText(String(value), sx(value), sy(0) + 10);
      context.textAlign = 'right';
      context.fillText(String(value), sx(0) - 4, sy(value));
    }
  }
  context.strokeStyle = 'rgba(217, 180, 90, 0.7)';
  context.lineWidth = 1.5;
  context.strokeRect(sx(0), sy(map.size), side, side);

  // Backdrop art, faintest of all: where the big sprites sit, far below the ship plane.
  map.scenery.nebulae.forEach((nebula) => {
    context.beginPath();
    context.arc(sx(nebula.x), sy(nebula.y), Math.max(6, (nebula.size / 2) * view.scale), 0, Math.PI * 2);
    context.fillStyle = withAlpha(nebula.tint, 0.07);
    context.fill();
    context.strokeStyle = withAlpha(nebula.tint, 0.5);
    context.setLineDash([3, 6]);
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.font = '10px ui-monospace, Menlo, monospace';
    context.textAlign = 'center';
    context.fillStyle = withAlpha(nebula.tint, 0.9);
    context.fillText(nebula.art, sx(nebula.x), sy(nebula.y));
  });
  if (map.scenery.band) {
    const band = map.scenery.band;
    context.save();
    context.translate(sx(band.x), sy(band.y));
    context.rotate(-band.rotation);
    context.strokeStyle = withAlpha(band.tint, 0.5);
    context.setLineDash([3, 6]);
    context.lineWidth = 1;
    context.strokeRect((-band.width / 2) * view.scale, (-band.height / 2) * view.scale, band.width * view.scale, band.height * view.scale);
    context.setLineDash([]);
    context.font = '10px ui-monospace, Menlo, monospace';
    context.textAlign = 'center';
    context.fillStyle = withAlpha(band.tint, 0.9);
    context.fillText('band', 0, 0);
    context.restore();
  }
  if (map.scenery.sun) {
    const sun = map.scenery.sun;
    context.beginPath();
    context.arc(sx(sun.x), sy(sun.y), Math.max(6, (sun.size / 2) * view.scale), 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 220, 140, 0.06)';
    context.fill();
    context.strokeStyle = 'rgba(255, 220, 140, 0.6)';
    context.setLineDash([3, 6]);
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.font = '10px ui-monospace, Menlo, monospace';
    context.textAlign = 'center';
    context.fillStyle = 'rgba(255, 220, 140, 0.9)';
    context.fillText('sun', sx(sun.x), sy(sun.y));
  }

  // Planets: faint discs behind everything.
  map.scenery.planets.forEach((planet) => {
    context.beginPath();
    context.arc(sx(planet.x), sy(planet.y), Math.max(4, planet.radius * view.scale), 0, Math.PI * 2);
    context.fillStyle = 'rgba(120, 150, 200, 0.10)';
    context.fill();
    context.strokeStyle = 'rgba(120, 150, 200, 0.45)';
    context.setLineDash([4, 4]);
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = 'rgba(160, 185, 225, 0.8)';
    context.textAlign = 'center';
    context.fillText(planet.art, sx(planet.x), sy(planet.y));
  });

  // Gas clouds, beacons and caches.
  map.objects.forEach((object) => {
    const cx = sx(object.x);
    const cy = sy(object.y);
    if (object.type === 'gas-cloud') {
      context.beginPath();
      context.arc(cx, cy, Math.max(4, object.radius * view.scale), 0, Math.PI * 2);
      context.fillStyle = withAlpha(object.colour, 0.16);
      context.fill();
      context.strokeStyle = withAlpha(object.colour, 0.8);
      context.lineWidth = 1.2;
      context.stroke();
      label(context, object.label, cx, cy - Math.max(4, object.radius * view.scale) - 6, object.colour);
    } else if (object.type === 'beacon') {
      context.beginPath();
      context.arc(cx, cy, Math.max(5, object.radius * view.scale), 0, Math.PI * 2);
      context.strokeStyle = object.colour;
      context.lineWidth = 1.5;
      context.stroke();
      context.beginPath();
      context.arc(cx, cy, 3, 0, Math.PI * 2);
      context.fillStyle = object.colour;
      context.fill();
      label(context, object.label, cx, cy - Math.max(5, object.radius * view.scale) - 6, object.colour);
    } else {
      context.beginPath();
      context.moveTo(cx, cy - 6);
      context.lineTo(cx + 6, cy);
      context.lineTo(cx, cy + 6);
      context.lineTo(cx - 6, cy);
      context.closePath();
      context.fillStyle = '#ffd86b';
      context.fill();
      context.strokeStyle = '#141620';
      context.lineWidth = 1;
      context.stroke();
      label(context, `${object.resource} ×${object.count}`, cx, cy - 10, '#ffd86b');
    }
  });

  // Rocks, coloured by kind.
  map.rocks.forEach((rock) => {
    context.beginPath();
    context.arc(sx(rock.x), sy(rock.y), Math.max(2.5, rock.radius * view.scale), 0, Math.PI * 2);
    context.fillStyle = ROCK_KINDS[rock.kind].colours[0] ?? '#8a8a8a';
    context.fill();
    context.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    context.lineWidth = 1;
    context.stroke();
  });

  // Markers: icons with their names, and region labels.
  map.markers.forEach((marker) => {
    const cx = sx(marker.x);
    const cy = sy(marker.y);
    if (marker.type === 'icon') {
      drawMapIcon(context, marker.icon, cx, cy, 20, marker.colour);
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.font = '11px system-ui, sans-serif';
      outlined(context, marker.label, cx + 14, cy, '#e6ecf5');
    } else {
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `600 ${Math.max(10, marker.size + 2)}px system-ui, sans-serif`;
      outlined(context, marker.text, cx, cy, marker.colour);
    }
  });

  // Spawn: a gold arrow pointing along the heading.
  {
    const cx = sx(map.spawn.x);
    const cy = sy(map.spawn.y);
    const bearing = (headingBearing(map.spawn.heading) * Math.PI) / 180;
    context.save();
    context.translate(cx, cy);
    context.rotate(bearing);
    context.beginPath();
    context.moveTo(0, -11);
    context.lineTo(8, 9);
    context.lineTo(0, 4);
    context.lineTo(-8, 9);
    context.closePath();
    context.fillStyle = '#d9b45a';
    context.fill();
    context.strokeStyle = '#141620';
    context.lineWidth = 1.2;
    context.stroke();
    context.restore();
    label(context, 'spawn', cx, cy - 16, '#d9b45a');
  }

  // Where the 3D view is looking.
  if (focus) {
    const fx = sx(focus.x);
    const fy = sy(focus.y);
    context.strokeStyle = 'rgba(111, 211, 255, 0.8)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(fx - 9, fy);
    context.lineTo(fx + 9, fy);
    context.moveTo(fx, fy - 9);
    context.lineTo(fx, fy + 9);
    context.stroke();
  }

  // Selection ring.
  if (selection) {
    const at = positionOf(map, selection);
    if (at) {
      const radius = selectionRadius(map, selection) * view.scale;
      context.beginPath();
      context.arc(sx(at.x), sy(at.y), Math.max(12, radius + 5), 0, Math.PI * 2);
      context.strokeStyle = '#6fd3ff';
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.stroke();
      context.setLineDash([]);
    }
  }
}

function selectionRadius(map: MapDefinition, selection: Selection): number {
  switch (selection.kind) {
    case 'rock':
      return map.rocks[selection.index]?.radius ?? 0;
    case 'object': {
      const object = map.objects[selection.index];
      return object && object.type !== 'cache' ? object.radius : 0;
    }
    case 'planet':
      return map.scenery.planets[selection.index]?.radius ?? 0;
    case 'nebula':
      return (map.scenery.nebulae[selection.index]?.size ?? 0) / 2;
    case 'sun':
      return (map.scenery.sun?.size ?? 0) / 2;
    case 'band':
      return map.scenery.band ? Math.max(map.scenery.band.width, map.scenery.band.height) / 2 : 0;
    default:
      return 0;
  }
}

function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
  context.font = '11px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  outlined(context, text, x, y, colour);
}

function outlined(context: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  context.lineJoin = 'round';
  context.strokeText(text, x, y);
  context.fillStyle = colour;
  context.fillText(text, x, y);
}

function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
