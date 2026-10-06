import { useEffect, useRef } from 'react';
import { resolveMap, type MapDefinition } from '../game/map';
import { fromMapCoords, headingBearing, toMapCoords } from '../game/mapCoords';
import { RockField, type Rock, type RockSpec } from '../game/rocks';
import type { Pickup } from '../game/loot';
import { drawMapIcon } from '../hud/mapIcons';
import { GameScene } from '../scene/gameScene';
import type { ShipVisualSpec } from '../scene/shipActor';
import { hitTest, positionOf, selectionLabel, type Point, type Selection } from './mapDocument';

export interface MapSceneProps {
  readonly map: MapDefinition;
  readonly selection: Selection | null;
  /** True when a click should select and drag rather than place. */
  readonly selecting: boolean;
  /** The player's ship, parked at the spawn so the scale reads. */
  readonly ship: ShipVisualSpec | null;
  /** A request to look at a map point (from the overview); a new object each time. */
  readonly jump: Point | null;
  readonly onPlace: (x: number, y: number) => void;
  readonly onSelect: (selection: Selection | null) => void;
  readonly onDragStart: () => void;
  readonly onDrag: (selection: Selection, x: number, y: number) => void;
  readonly onDragEnd: () => void;
  readonly onHover: (point: Point | null) => void;
  /** Where the camera is looking, in map coordinates, after a pan or jump. */
  readonly onViewChange: (point: Point) => void;
}

const EDITOR_MIN_DISTANCE = 40;
const EDITOR_MAX_DISTANCE = 3000;
const EDITOR_TILT = 24;
const BOUNDARY_COLOUR = '#d9b45a';
const SPAWN_SHIP_ID = 'spawn';

/**
 * The editor's main view: the flight scene itself (backdrop, 3D rocks,
 * gas clouds, beacons, caches and your ship at the spawn) with the pointer
 * picking against the ship plane, plus a 2D overlay for the things the
 * scene does not draw: marker icons, labels and the selection ring.
 */
export function MapScene(props: MapSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const sceneRef = useRef<GameScene | null>(null);
  const focus = useRef({ x: 0, z: 0 });
  const rocksRef = useRef<readonly Rock[]>([]);
  const hovered = useRef<Selection | null>(null);
  const worldKey = useRef('');

  // Build the scene once and run its frame loop.
  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (!host || !overlay) return;
    const first = resolveMap(latest.current.map);
    const scene = new GameScene(host, { seed: first.seed, halfExtent: first.halfExtent, boundaryColour: BOUNDARY_COLOUR, scenery: first.scenery });
    scene.setPixelation(0, '3d');
    scene.camera.setDistanceRange(EDITOR_MIN_DISTANCE, EDITOR_MAX_DISTANCE);
    scene.camera.setTilt(EDITOR_TILT);
    scene.camera.setDistance(latest.current.map.size * 1.15);
    focus.current = { x: first.spawn.x, z: first.spawn.z };
    scene.camera.snapTo(focus.current.x, focus.current.z);
    sceneRef.current = scene;
    worldKey.current = '';
    syncMap(scene, latest.current.map, latest.current.ship, rocksRef, worldKey, hovered.current);

    const context = overlay.getContext('2d');
    let handle = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      scene.camera.update(focus.current.x, focus.current.z, 0, 0, dt);
      scene.update(dt, now / 1000);
      scene.render();
      if (context) drawOverlay(context, overlay, scene, latest.current.map, latest.current.selection, hovered.current);
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);

    const surface = scene.surface;
    const worldAt = (clientX: number, clientY: number): readonly [number, number] | null => {
      const rect = surface.getBoundingClientRect();
      return scene.aimPoint(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    };
    const mapAt = (clientX: number, clientY: number): Point | null => {
      const world = worldAt(clientX, clientY);
      if (!world) return null;
      const point = toMapCoords(world[0], world[1], latest.current.map.size / 2);
      return { x: point.x, y: point.y };
    };
    /** Map units per screen pixel around the camera focus, for click tolerances. */
    const unitsPerPixel = (): number => {
      const a = scene.projectRaw(focus.current.x, 0, focus.current.z).screen;
      const b = scene.projectRaw(focus.current.x + 10, 0, focus.current.z).screen;
      const pixels = Math.hypot(a.x - b.x, a.y - b.y);
      return pixels > 0 ? 10 / pixels : 1;
    };
    /**
     * Backdrop art sits deep below the ship plane and parallax shifts it, so
     * it is picked where it appears on screen rather than by its map position.
     * Smallest first, so a moon on a nebula is still clickable.
     */
    const sceneryAt = (clientX: number, clientY: number): Selection | null => {
      const rect = surface.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const map = latest.current.map;
      const half = map.size / 2;
      const candidates: Array<{ selection: Selection; priority: number; distance: number }> = [];
      const consider = (selection: Selection, x: number, y: number, depth: number, radius: number, priority: number): void => {
        const world = fromMapCoords(x, y, half);
        const centre = scene.projectRaw(world.x, depth, world.z).screen;
        const edge = scene.projectRaw(world.x + radius, depth, world.z).screen;
        const pixels = Math.max(12, Math.hypot(edge.x - centre.x, edge.y - centre.y));
        const distance = Math.hypot(centre.x - px, centre.y - py);
        if (distance <= pixels) candidates.push({ selection, priority, distance: distance / pixels });
      };
      map.scenery.planets.forEach((planet, index) => consider({ kind: 'planet', index }, planet.x, planet.y, planet.depth, planet.radius, 0));
      if (map.scenery.sun) consider({ kind: 'sun' }, map.scenery.sun.x, map.scenery.sun.y, map.scenery.sun.depth, map.scenery.sun.size / 2, 1);
      map.scenery.nebulae.forEach((nebula, index) => consider({ kind: 'nebula', index }, nebula.x, nebula.y, nebula.depth, nebula.size / 2, 2));
      if (map.scenery.band) consider({ kind: 'band' }, map.scenery.band.x, map.scenery.band.y, map.scenery.band.depth, Math.min(map.scenery.band.width, map.scenery.band.height) / 2, 3);
      candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
      return candidates[0]?.selection ?? null;
    };
    const reportView = (): void => {
      const point = toMapCoords(focus.current.x, focus.current.z, latest.current.map.size / 2);
      latest.current.onViewChange({ x: point.x, y: point.y });
    };
    const setHover = (next: Selection | null): void => {
      if (sameSelection(hovered.current, next)) return;
      hovered.current = next;
      scene.syncRocks(rocksRef.current, next?.kind === 'rock' ? (latest.current.map.rocks[next.index]?.id ?? null) : null);
      const object = next?.kind === 'object' ? latest.current.map.objects[next.index] : undefined;
      scene.setHazardHovered(object?.type === 'gas-cloud' ? object.id : null);
    };

    let panning: { anchorX: number; anchorZ: number } | null = null;
    let dragging: { selection: Selection; dx: number; dy: number } | null = null;

    const onPointerDown = (event: PointerEvent): void => {
      surface.setPointerCapture(event.pointerId);
      if (event.button === 1 || event.button === 2) {
        const world = worldAt(event.clientX, event.clientY);
        if (world) panning = { anchorX: world[0], anchorZ: world[1] };
        return;
      }
      if (event.button !== 0) return;
      const point = mapAt(event.clientX, event.clientY);
      if (!point) return;
      const state = latest.current;
      if (!state.selecting) {
        state.onPlace(point.x, point.y);
        return;
      }
      const hit = hitTest(state.map, point.x, point.y, 10 * unitsPerPixel()) ?? sceneryAt(event.clientX, event.clientY);
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
      if (panning) {
        const world = worldAt(event.clientX, event.clientY);
        if (world) {
          focus.current.x += panning.anchorX - world[0];
          focus.current.z += panning.anchorZ - world[1];
          scene.camera.snapTo(focus.current.x, focus.current.z);
        }
        return;
      }
      const point = mapAt(event.clientX, event.clientY);
      latest.current.onHover(point);
      if (dragging) {
        if (point) latest.current.onDrag(dragging.selection, point.x + dragging.dx, point.y + dragging.dy);
        return;
      }
      if (latest.current.selecting && point) setHover(hitTest(latest.current.map, point.x, point.y, 10 * unitsPerPixel()) ?? sceneryAt(event.clientX, event.clientY));
      else setHover(null);
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      if (panning) {
        panning = null;
        reportView();
      }
      if (dragging) {
        dragging = null;
        latest.current.onDragEnd();
      }
    };
    const onPointerLeave = (): void => {
      latest.current.onHover(null);
      setHover(null);
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      scene.camera.zoomBy(Math.exp(event.deltaY * 0.0012));
    };
    const onContextMenu = (event: Event): void => event.preventDefault();
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (event.code === 'KeyQ') scene.camera.tiltBy(-4);
      else if (event.code === 'KeyE') scene.camera.tiltBy(4);
      else if (event.code === 'KeyC') scene.camera.toggleMode();
    };

    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerUp);
    surface.addEventListener('pointercancel', onPointerUp);
    surface.addEventListener('pointerleave', onPointerLeave);
    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey);
    reportView();

    return () => {
      cancelAnimationFrame(handle);
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerUp);
      surface.removeEventListener('pointerleave', onPointerLeave);
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKey);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Mirror the document into the scene whenever it changes.
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) syncMap(scene, props.map, props.ship, rocksRef, worldKey, hovered.current);
  }, [props.map, props.ship]);

  // Look at a point when the overview asks.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !props.jump) return;
    const world = fromMapCoords(props.jump.x, props.jump.y, props.map.size / 2);
    focus.current = { x: world.x, z: world.z };
    props.onViewChange(props.jump);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jump]);

  return (
    <div ref={hostRef} className={`map-editor-scene${props.selecting ? '' : ' placing'}`}>
      <canvas ref={overlayRef} className="map-editor-overlay" />
    </div>
  );
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return 'index' in a && 'index' in b ? a.index === b.index : true;
}

/** How far below the ship plane a selection's art sits, for projecting it where it appears. */
function liftOf(map: MapDefinition, selection: Selection): number {
  switch (selection.kind) {
    case 'planet':
      return map.scenery.planets[selection.index]?.depth ?? 0;
    case 'nebula':
      return map.scenery.nebulae[selection.index]?.depth ?? 0;
    case 'sun':
      return map.scenery.sun?.depth ?? 0;
    case 'band':
      return map.scenery.band?.depth ?? 0;
    default:
      return 0;
  }
}

/** Resolve the document and push every part of it into the scene; the backdrop only when seed, size or scenery changed. */
function syncMap(
  scene: GameScene,
  map: MapDefinition,
  ship: ShipVisualSpec | null,
  rocksRef: { current: readonly Rock[] },
  worldKey: { current: string },
  hovered: Selection | null,
): void {
  const resolved = resolveMap(map);
  const key = JSON.stringify([map.seed, map.size, map.scenery]);
  if (key !== worldKey.current) {
    worldKey.current = key;
    scene.setWorld({ seed: resolved.seed, halfExtent: resolved.halfExtent, boundaryColour: BOUNDARY_COLOUR, scenery: resolved.scenery });
  }
  // A duplicate id (mid-edit) must not take the view down: the first rock keeps the id for drawing.
  const seen = new Set<string>();
  const specs: RockSpec[] = [];
  for (const spec of resolved.rockSpecs) {
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    specs.push(spec);
  }
  const field = new RockField(specs);
  rocksRef.current = field.inView(0, 0, resolved.halfExtent * 4);
  scene.syncRocks(rocksRef.current, hovered?.kind === 'rock' ? (map.rocks[hovered.index]?.id ?? null) : null);
  scene.setHazards(resolved.hazards);
  scene.setBeacons(resolved.beacons);
  const pickups: Pickup[] = resolved.caches.map((cache, index) => ({ id: index + 1, kind: cache.resource, count: cache.count, x: cache.x, z: cache.z, life: Infinity, phase: index * 0.7, armed: true }));
  scene.syncLoot(pickups);
  if (ship) {
    if (!scene.hasShip(SPAWN_SHIP_ID)) scene.addShip(SPAWN_SHIP_ID, ship);
    scene.setShipPose(SPAWN_SHIP_ID, { x: resolved.spawn.x, z: resolved.spawn.z, heading: resolved.spawn.heading, throttle: 0.2, visible: true });
  }
}

/** Markers, labels, the spawn and the selection ring, drawn in screen space over the 3D view. */
function drawOverlay(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, scene: GameScene, map: MapDefinition, selection: Selection | null, hovered: Selection | null): void {
  const { width, height } = scene.size;
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const half = map.size / 2;
  const at = (x: number, y: number, lift = 0): { x: number; y: number } | null => {
    const world = fromMapCoords(x, y, half);
    return scene.project(world.x, lift, world.z);
  };
  context.textBaseline = 'middle';

  map.objects.forEach((object) => {
    const p = at(object.x, object.y, 1);
    if (!p) return;
    if (object.type === 'cache') label(context, `${object.resource} ×${object.count}`, p.x, p.y - 16, '#ffd86b');
    else label(context, object.label, p.x, p.y - 14, object.colour);
  });
  map.markers.forEach((marker) => {
    const p = at(marker.x, marker.y, 0.5);
    if (!p) return;
    if (marker.type === 'icon') {
      drawMapIcon(context, marker.icon, p.x, p.y, 22, marker.colour);
      context.font = '12px system-ui, sans-serif';
      context.textAlign = 'left';
      outlined(context, marker.label, p.x + 15, p.y, '#e6ecf5');
    } else {
      context.font = `600 ${Math.max(11, marker.size + 3)}px system-ui, sans-serif`;
      context.textAlign = 'center';
      outlined(context, marker.text, p.x, p.y, marker.colour);
    }
  });
  {
    const p = at(map.spawn.x, map.spawn.y, 0);
    if (p) {
      const bearing = (headingBearing(map.spawn.heading) * Math.PI) / 180;
      context.save();
      context.translate(p.x, p.y);
      context.rotate(bearing);
      context.beginPath();
      context.moveTo(0, -14);
      context.lineTo(9, 10);
      context.lineTo(0, 5);
      context.lineTo(-9, 10);
      context.closePath();
      context.strokeStyle = '#d9b45a';
      context.lineWidth = 1.5;
      context.stroke();
      context.restore();
      label(context, 'spawn', p.x, p.y - 22, '#d9b45a');
    }
  }
  const ring = (target: Selection, colour: string, dash: number[], width: number, named: boolean): void => {
    const position = positionOf(map, target);
    if (!position) return;
    const lift = liftOf(map, target);
    const world = fromMapCoords(position.x, position.y, half);
    const centre = scene.projectRaw(world.x, lift, world.z).screen;
    const edge = scene.projectRaw(world.x + selectionRadius(map, target), lift, world.z).screen;
    const pixels = Math.hypot(edge.x - centre.x, edge.y - centre.y);
    context.beginPath();
    context.arc(centre.x, centre.y, Math.max(14, pixels + 6), 0, Math.PI * 2);
    context.strokeStyle = colour;
    context.lineWidth = width;
    context.setLineDash(dash);
    context.stroke();
    context.setLineDash([]);
    if (named) label(context, selectionLabel(map, target), centre.x, centre.y - Math.max(14, pixels + 6) - 10, colour);
  };
  if (hovered && !sameSelection(hovered, selection)) ring(hovered, 'rgba(255, 255, 255, 0.55)', [3, 5], 1.2, false);
  if (selection) ring(selection, '#6fd3ff', [7, 5], 2, true);
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
      return map.scenery.band ? Math.min(map.scenery.band.width, map.scenery.band.height) / 2 : 0;
    default:
      return 0;
  }
}

function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
  context.font = '11px system-ui, sans-serif';
  context.textAlign = 'center';
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
