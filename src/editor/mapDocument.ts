import type { ResourceKind } from '../game/loot';
import {
  DEFAULT_STAR_LAYERS,
  GAS_CLOUD_DEFAULTS,
  LABEL_DEFAULTS,
  MapParseError,
  generateMapRocks,
  parseMapDefinition,
  type MapBand,
  type MapDefinition,
  type MapIconName,
  type MapMarker,
  type MapNebula,
  type MapObject,
  type MapPlanet,
  type MapRock,
  type MapSun,
  type StarLayerSpec,
} from '../game/map';
import { DEFAULT_ROCK_RESPAWN, type RockKind } from '../game/rocks';

/**
 * The map editor's document operations: pure functions from one
 * MapDefinition to the next, in map coordinates ((0, 0) bottom-left). The
 * editor view calls these; tests cover them without a DOM. Every result is
 * a valid MapDefinition, so "save" is just JSON.stringify.
 */

export type Selection =
  | { readonly kind: 'rock'; readonly index: number }
  | { readonly kind: 'object'; readonly index: number }
  | { readonly kind: 'marker'; readonly index: number }
  | { readonly kind: 'planet'; readonly index: number }
  | { readonly kind: 'nebula'; readonly index: number }
  | { readonly kind: 'sun' }
  | { readonly kind: 'band' }
  | { readonly kind: 'spawn' };

/** Backdrop art sits below the ship plane and often outside the map square, so it is never clamped. */
export function isScenery(selection: Selection): boolean {
  return selection.kind === 'planet' || selection.kind === 'nebula' || selection.kind === 'sun' || selection.kind === 'band';
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Placed<T> {
  readonly map: MapDefinition;
  readonly selection: T;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampToMap(map: MapDefinition, x: number, y: number): Point {
  return { x: round2(Math.min(map.size, Math.max(0, x))), y: round2(Math.min(map.size, Math.max(0, y))) };
}

/** `prefix-0001`, `prefix-0002`, ... the first one not already taken. */
export function nextId(existing: Iterable<string>, prefix: string): string {
  const taken = new Set(existing);
  for (let n = 1; ; n++) {
    const id = `${prefix}-${String(n).padStart(4, '0')}`;
    if (!taken.has(id)) return id;
  }
}

function objectIds(map: MapDefinition): string[] {
  return map.objects.flatMap((object) => (object.type === 'cache' ? [] : [object.id]));
}

export interface RockOptions {
  readonly kind: RockKind;
  readonly radius: number;
  readonly respawn: number | null;
}

export const DEFAULT_ROCK_OPTIONS: RockOptions = { kind: 'stone', radius: 3, respawn: DEFAULT_ROCK_RESPAWN };

export function addRock(map: MapDefinition, x: number, y: number, options: RockOptions = DEFAULT_ROCK_OPTIONS): Placed<Selection> {
  const point = clampToMap(map, x, y);
  const rock: MapRock = { id: nextId(map.rocks.map((r) => r.id), 'rock'), x: point.x, y: point.y, kind: options.kind, radius: options.radius, respawn: options.respawn };
  return { map: { ...map, rocks: [...map.rocks, rock] }, selection: { kind: 'rock', index: map.rocks.length } };
}

export interface ClusterOptions {
  readonly count: number;
  readonly radius: number;
  readonly kind: RockKind;
  readonly crystalChance: number;
  readonly respawn: number | null;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = { count: 12, radius: 40, kind: 'stone', crystalChance: 0.1, respawn: DEFAULT_ROCK_RESPAWN };

/** Scatter a cluster of rocks around a point with the same generator the parser's `generate` sugar uses; ids continue the map's sequence. */
export function addCluster(map: MapDefinition, x: number, y: number, options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS): { readonly map: MapDefinition; readonly added: number } {
  const generated = generateMapRocks(
    { clusters: [{ x, y, radius: options.radius, count: options.count, kind: options.kind, crystalChance: options.crystalChance }], giants: [], scatter: null, respawn: options.respawn },
    map.seed + map.rocks.length * 7919,
    map.size,
    map.spawn,
  );
  const taken = new Set(map.rocks.map((r) => r.id));
  const rocks = [...map.rocks];
  for (const rock of generated) {
    if (rock.x < 0 || rock.x > map.size || rock.y < 0 || rock.y > map.size) continue;
    const id = nextId(taken, 'rock');
    taken.add(id);
    rocks.push({ ...rock, id });
  }
  return { map: { ...map, rocks }, added: rocks.length - map.rocks.length };
}

export type ObjectType = MapObject['type'];

export function addObject(map: MapDefinition, type: ObjectType, x: number, y: number): Placed<Selection> {
  const point = clampToMap(map, x, y);
  const ids = objectIds(map);
  const object: MapObject =
    type === 'cache'
      ? { type: 'cache', x: point.x, y: point.y, resource: 'stone', count: 5 }
      : type === 'beacon'
        ? { type: 'beacon', id: nextId(ids, 'beacon'), x: point.x, y: point.y, label: 'Beacon', description: '', colour: '#6fd3ff', radius: 12 }
        : { type: 'gas-cloud', id: nextId(ids, 'gas'), x: point.x, y: point.y, ...GAS_CLOUD_DEFAULTS };
  return { map: { ...map, objects: [...map.objects, object] }, selection: { kind: 'object', index: map.objects.length } };
}

export function addMarker(map: MapDefinition, type: MapMarker['type'], x: number, y: number, icon: MapIconName = 'flag'): Placed<Selection> {
  const point = clampToMap(map, x, y);
  const marker: MapMarker =
    type === 'icon'
      ? { type: 'icon', x: point.x, y: point.y, icon, label: 'Marker', colour: null, onMinimap: true }
      : { type: 'label', x: point.x, y: point.y, text: 'Label', colour: LABEL_DEFAULTS.colour, size: LABEL_DEFAULTS.size, onMinimap: false };
  return { map: { ...map, markers: [...map.markers, marker] }, selection: { kind: 'marker', index: map.markers.length } };
}

export function addPlanet(map: MapDefinition, x: number, y: number, art: string): Placed<Selection> {
  const planet: MapPlanet = { art, x: round2(x), y: round2(y), depth: -2200, radius: Math.round(map.size * 0.08), rotation: 0 };
  return { map: { ...map, scenery: { ...map.scenery, planets: [...map.scenery.planets, planet] } }, selection: { kind: 'planet', index: map.scenery.planets.length } };
}

/** Nebula art names, without extension: the files in public/assets/space. */
export const NEBULA_ART_NAMES: readonly string[] = ['nebula-01', 'nebula-02', 'nebula-03'];
/** Tints the built-in maps use; any hex colour works. */
export const NEBULA_TINTS: readonly string[] = ['#6a3fb0', '#2a7a8c', '#8c2a5a', '#2f5fa8', '#8fa6d8'];

export function addNebula(map: MapDefinition, x: number, y: number, art: string, tint = NEBULA_TINTS[0]!): Placed<Selection> {
  const nebula: MapNebula = { art, x: round2(x), y: round2(y), depth: -6000, size: 6000, tint, opacity: 0.5, rotation: 0 };
  return { map: { ...map, scenery: { ...map.scenery, nebulae: [...map.scenery.nebulae, nebula] } }, selection: { kind: 'nebula', index: map.scenery.nebulae.length } };
}

/** Put the sun here, or move it if there is one; a map has at most one. */
export function placeSun(map: MapDefinition, x: number, y: number): Placed<Selection> {
  const sun: MapSun = map.scenery.sun ? { ...map.scenery.sun, x: round2(x), y: round2(y) } : { x: round2(x), y: round2(y), depth: -7000, size: 6000 };
  return { map: { ...map, scenery: { ...map.scenery, sun } }, selection: { kind: 'sun' } };
}

/** Put the galactic band here, or move it; one per map. */
export function placeBand(map: MapDefinition, x: number, y: number, art = 'nebula-02'): Placed<Selection> {
  const band: MapBand = map.scenery.band
    ? { ...map.scenery.band, x: round2(x), y: round2(y) }
    : { art, x: round2(x), y: round2(y), depth: -6500, width: 30000, height: 7000, tint: '#8fa6d8', opacity: 0.22, rotation: 0.55 };
  return { map: { ...map, scenery: { ...map.scenery, band } }, selection: { kind: 'band' } };
}

// ---- star layers -------------------------------------------------------------

export interface StarPreset {
  readonly id: string;
  readonly name: string;
  readonly layers: readonly StarLayerSpec[];
}

export const STAR_PRESETS: readonly StarPreset[] = [
  { id: 'default', name: 'Default', layers: DEFAULT_STAR_LAYERS },
  { id: 'sparse', name: 'Sparse', layers: DEFAULT_STAR_LAYERS.map((layer) => ({ ...layer, count: Math.round(layer.count * 0.35) })) },
  { id: 'dense', name: 'Dense', layers: DEFAULT_STAR_LAYERS.map((layer) => ({ ...layer, count: Math.round(layer.count * 1.8), brightness: round2(layer.brightness * 1.15) })) },
  { id: 'none', name: 'None', layers: [] },
];

export const DEFAULT_STAR_LAYER: StarLayerSpec = { kind: 'field', depth: -4000, tile: 6000, count: 800, sizeWorld: 20, sizePx: 2, brightness: 0.8 };

export function setStarLayers(map: MapDefinition, stars: readonly StarLayerSpec[]): MapDefinition {
  return { ...map, scenery: { ...map.scenery, stars } };
}

export function addStarLayer(map: MapDefinition, layer: StarLayerSpec = DEFAULT_STAR_LAYER): MapDefinition {
  return setStarLayers(map, [...map.scenery.stars, layer]);
}

export function patchStarLayer(map: MapDefinition, index: number, patch: Partial<StarLayerSpec>): MapDefinition {
  return setStarLayers(
    map,
    map.scenery.stars.map((layer, i) => (i === index ? ({ ...layer, ...patch } as StarLayerSpec) : layer)),
  );
}

export function removeStarLayer(map: MapDefinition, index: number): MapDefinition {
  return setStarLayers(
    map,
    map.scenery.stars.filter((_, i) => i !== index),
  );
}

export function setSpawn(map: MapDefinition, x: number, y: number, heading = map.spawn.heading): MapDefinition {
  return { ...map, spawn: { ...clampToMap(map, x, y), heading } };
}

export function positionOf(map: MapDefinition, selection: Selection): Point | null {
  switch (selection.kind) {
    case 'spawn':
      return map.spawn;
    case 'rock':
      return map.rocks[selection.index] ?? null;
    case 'object':
      return map.objects[selection.index] ?? null;
    case 'marker':
      return map.markers[selection.index] ?? null;
    case 'planet':
      return map.scenery.planets[selection.index] ?? null;
    case 'nebula':
      return map.scenery.nebulae[selection.index] ?? null;
    case 'sun':
      return map.scenery.sun;
    case 'band':
      return map.scenery.band;
  }
}

/** Replace fields on the selected thing. The editor's forms send typed values; nothing here re-validates. */
export function patchSelection(map: MapDefinition, selection: Selection, patch: Readonly<Record<string, unknown>>): MapDefinition {
  const replace = <T>(items: readonly T[], index: number): T[] => items.map((item, i) => (i === index ? ({ ...item, ...patch } as T) : item));
  switch (selection.kind) {
    case 'spawn':
      return { ...map, spawn: { ...map.spawn, ...patch } as MapDefinition['spawn'] };
    case 'rock':
      return { ...map, rocks: replace(map.rocks, selection.index) };
    case 'object':
      return { ...map, objects: replace(map.objects, selection.index) };
    case 'marker':
      return { ...map, markers: replace(map.markers, selection.index) };
    case 'planet':
      return { ...map, scenery: { ...map.scenery, planets: replace(map.scenery.planets, selection.index) } };
    case 'nebula':
      return { ...map, scenery: { ...map.scenery, nebulae: replace(map.scenery.nebulae, selection.index) } };
    case 'sun':
      return map.scenery.sun ? { ...map, scenery: { ...map.scenery, sun: { ...map.scenery.sun, ...patch } as MapSun } } : map;
    case 'band':
      return map.scenery.band ? { ...map, scenery: { ...map.scenery, band: { ...map.scenery.band, ...patch } as MapBand } } : map;
  }
}

export function moveSelection(map: MapDefinition, selection: Selection, x: number, y: number): MapDefinition {
  const point = isScenery(selection) ? { x: round2(x), y: round2(y) } : clampToMap(map, x, y);
  return patchSelection(map, selection, { x: point.x, y: point.y });
}

export function deleteSelection(map: MapDefinition, selection: Selection): MapDefinition {
  const without = <T>(items: readonly T[], index: number): T[] => items.filter((_, i) => i !== index);
  switch (selection.kind) {
    case 'spawn':
      return map;
    case 'rock':
      return { ...map, rocks: without(map.rocks, selection.index) };
    case 'object':
      return { ...map, objects: without(map.objects, selection.index) };
    case 'marker':
      return { ...map, markers: without(map.markers, selection.index) };
    case 'planet':
      return { ...map, scenery: { ...map.scenery, planets: without(map.scenery.planets, selection.index) } };
    case 'nebula':
      return { ...map, scenery: { ...map.scenery, nebulae: without(map.scenery.nebulae, selection.index) } };
    case 'sun':
      return { ...map, scenery: { ...map.scenery, sun: null } };
    case 'band':
      return { ...map, scenery: { ...map.scenery, band: null } };
  }
}

/**
 * What is under a point. Small things win over big ones (a cache inside a
 * gas cloud is selectable), and `tolerance` (map units) makes tiny things
 * clickable at any zoom.
 */
export function hitTest(map: MapDefinition, x: number, y: number, tolerance: number): Selection | null {
  const candidates: Array<{ readonly selection: Selection; readonly priority: number; readonly distance: number }> = [];
  const consider = (selection: Selection, px: number, py: number, radius: number, priority: number): void => {
    const distance = Math.hypot(px - x, py - y);
    if (distance <= Math.max(radius, tolerance)) candidates.push({ selection, priority, distance });
  };
  consider({ kind: 'spawn' }, map.spawn.x, map.spawn.y, 0, 0);
  map.markers.forEach((marker, index) => consider({ kind: 'marker', index }, marker.x, marker.y, 0, 1));
  map.objects.forEach((object, index) => {
    if (object.type === 'gas-cloud') consider({ kind: 'object', index }, object.x, object.y, object.radius, 5);
    else consider({ kind: 'object', index }, object.x, object.y, object.type === 'beacon' ? object.radius : 0, 2);
  });
  map.rocks.forEach((rock, index) => consider({ kind: 'rock', index }, rock.x, rock.y, rock.radius, 3));
  map.scenery.planets.forEach((planet, index) => consider({ kind: 'planet', index }, planet.x, planet.y, planet.radius, 4));
  candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
  return candidates[0]?.selection ?? null;
}

export function setMapSettings(map: MapDefinition, patch: { readonly name?: string; readonly size?: number; readonly seed?: number }): MapDefinition {
  return { ...map, ...patch };
}

export function setCometEnabled(map: MapDefinition, enabled: boolean): MapDefinition {
  return { ...map, comet: { ...map.comet, enabled } };
}

export function toJson(map: MapDefinition): string {
  return `${JSON.stringify(map, null, 2)}\n`;
}

export type ParseResult = { readonly ok: true; readonly map: MapDefinition } | { readonly ok: false; readonly error: string };

/** Untrusted JSON text to a map, with the parser's path-naming error when it is not one. */
export function fromJson(text: string): ParseResult {
  try {
    return { ok: true, map: parseMapDefinition(JSON.parse(text) as unknown) };
  } catch (error) {
    return { ok: false, error: error instanceof MapParseError || error instanceof SyntaxError ? error.message : String(error) };
  }
}

/** An empty square with the default star field and nothing else: the parser fills in the rest. */
export function blankMap(name = 'New Map', size = 1000): MapDefinition {
  return parseMapDefinition({ name, size, seed: Math.floor(Math.random() * 1_000_000), rocks: [], objects: [], markers: [], comet: null, scenery: { planets: [], nebulae: [], sun: null, band: null } });
}

export function selectionLabel(map: MapDefinition, selection: Selection): string {
  switch (selection.kind) {
    case 'spawn':
      return 'Spawn';
    case 'rock': {
      const rock = map.rocks[selection.index];
      return rock ? `Rock ${rock.id}` : 'Rock';
    }
    case 'object': {
      const object = map.objects[selection.index];
      if (!object) return 'Object';
      return object.type === 'cache' ? `Cache (${object.resource})` : object.type === 'beacon' ? `Beacon ${object.id}` : `Gas cloud ${object.id}`;
    }
    case 'marker': {
      const marker = map.markers[selection.index];
      if (!marker) return 'Marker';
      return marker.type === 'icon' ? `Icon ${marker.icon}` : `Label "${marker.text}"`;
    }
    case 'planet': {
      const planet = map.scenery.planets[selection.index];
      return planet ? `Planet ${planet.art}` : 'Planet';
    }
    case 'nebula': {
      const nebula = map.scenery.nebulae[selection.index];
      return nebula ? `Nebula ${nebula.art}` : 'Nebula';
    }
    case 'sun':
      return 'Sun';
    case 'band':
      return 'Galactic band';
  }
}

export function summarize(map: MapDefinition): { readonly rocks: number; readonly objects: number; readonly markers: number; readonly planets: number; readonly nebulae: number } {
  return { rocks: map.rocks.length, objects: map.objects.length, markers: map.markers.length, planets: map.scenery.planets.length, nebulae: map.scenery.nebulae.length };
}

export const RESOURCE_OPTIONS: readonly ResourceKind[] = ['stone', 'iron-ore', 'ice', 'crystal'];
