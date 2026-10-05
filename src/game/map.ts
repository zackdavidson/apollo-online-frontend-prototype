import type { Beacon } from './beacons';
import type { Hazard } from './hazards';
import { COMET_TUNING, type CometTuning } from './comet';
import type { ResourceKind } from './loot';
import { fromMapCoords } from './mapCoords';
import { createRng } from './random';
import { DEFAULT_ROCK_LAYOUT, DEFAULT_ROCK_RESPAWN, ROCK_KINDS, layoutToSpecs, type RockKind, type RockSpec } from './rocks';
import { toMapCoords } from './mapCoords';

/**
 * Map definitions: a JSON-friendly description of everything in a sector
 * except the ships. Authored in map coordinates ((0, 0) bottom-left, x right,
 * y up, both 0..size) and resolved into world coordinates for the
 * simulation and the scene. `parseMapDefinition` validates untrusted JSON
 * and fills in defaults; `resolveMap` does the coordinate conversion.
 */

export interface StarLayerSpec {
  readonly kind: 'field' | 'clusters';
  readonly depth: number;
  /** Tile edge length; 3x3 tiles are kept around the camera. */
  readonly tile: number;
  readonly count: number;
  /** Number of clumps per tile for the 'clusters' kind. */
  readonly clusters?: number;
  /** Point size in world units for the perspective camera. */
  readonly sizeWorld: number;
  /** Point size in pixels for the orthographic camera. */
  readonly sizePx: number;
  readonly brightness: number;
}

export interface MapPlanet {
  /** Art name without extension, e.g. "planet-gas-01" or "moon-02". */
  readonly art: string;
  readonly x: number;
  readonly y: number;
  /** Depth below the ship plane (negative numbers). Deeper means slower parallax. */
  readonly depth: number;
  readonly radius: number;
  readonly rotation: number;
}

export interface MapNebula {
  readonly art: string;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly size: number;
  readonly tint: string;
  readonly opacity: number;
  readonly rotation: number;
}

export interface MapSun {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly size: number;
}

export interface MapBand {
  readonly art: string;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly width: number;
  readonly height: number;
  readonly tint: string;
  readonly opacity: number;
  readonly rotation: number;
}

export interface MapScenery {
  readonly stars: readonly StarLayerSpec[];
  readonly planets: readonly MapPlanet[];
  readonly sun: MapSun | null;
  readonly nebulae: readonly MapNebula[];
  readonly band: MapBand | null;
}

/**
 * One rock, defined explicitly. This is the only form a saved map holds, so
 * a server can key every rock's state (health, destroyed, respawn timer) on
 * its id and stream it to players who have it in view.
 */
export interface MapRock {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: RockKind;
  readonly radius: number;
  /** Seconds before a mined-out rock reappears; null means never. */
  readonly respawn: number | null;
}

/**
 * Authoring sugar accepted by the parser in place of a rock list:
 * `"rocks": { "generate": { ... } }` expands deterministically (by seed) into
 * explicit MapRock entries at parse time. It never survives into a
 * MapDefinition, so saving a parsed map always writes the explicit list.
 */
export interface MapRockGenerate {
  readonly clusters: ReadonlyArray<{ readonly x: number; readonly y: number; readonly radius: number; readonly count: number; readonly kind: RockKind; readonly crystalChance: number }>;
  readonly giants: ReadonlyArray<{ readonly x: number; readonly y: number; readonly radius: number }>;
  readonly scatter: { readonly clusters: number; readonly perCluster: number; readonly clusterRadius: number; readonly keepClear: number; readonly giants: number } | null;
  readonly respawn: number | null;
}

export type MapObject =
  | { readonly type: 'cache'; readonly x: number; readonly y: number; readonly resource: ResourceKind; readonly count: number }
  | {
      readonly type: 'beacon';
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly label: string;
      readonly description: string;
      readonly colour: string;
      readonly radius: number;
    }
  | {
      /** A cloud that damages any ship inside its radius, every half second, for as long as it stays. */
      readonly type: 'gas-cloud';
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly damagePerSecond: number;
      readonly label: string;
      readonly colour: string;
    };

export const GAS_CLOUD_DEFAULTS = { radius: 60, damagePerSecond: 10, label: 'Toxic gas', colour: '#9bff3d' } as const;

/** Icons a map may pin on the minimap, old-school style. Drawn by the HUD; the names are the contract. */
export const MAP_ICON_NAMES = ['home', 'mine', 'crystal', 'skull', 'shop', 'repair', 'quest', 'flag', 'star', 'gate', 'fuel', 'anchor'] as const;
export type MapIconName = (typeof MAP_ICON_NAMES)[number];

/**
 * Minimap annotations. Pure presentation: nothing in the simulation reads
 * them. Labels name regions; icons mark places. Both are optional and
 * live in the map JSON so authors can say where things are.
 */
export type MapMarker =
  | { readonly type: 'label'; readonly x: number; readonly y: number; readonly text: string; readonly colour: string; readonly size: number; readonly onMinimap: boolean }
  | { readonly type: 'icon'; readonly x: number; readonly y: number; readonly icon: MapIconName; readonly label: string; readonly colour: string | null; readonly onMinimap: boolean };

export const LABEL_DEFAULTS = { colour: '#dfe6f2', size: 11 } as const;

export interface MapComet extends CometTuning {
  readonly enabled: boolean;
  /** First comet starts near the spawn so it is on the radar right away. */
  readonly firstNearStart: boolean;
}

export interface MapDefinition {
  readonly version: 1;
  readonly name: string;
  /** Side length of the square map in world units. */
  readonly size: number;
  readonly seed: number;
  readonly spawn: { readonly x: number; readonly y: number; readonly heading: number };
  readonly scenery: MapScenery;
  /** Every rock, explicitly. */
  readonly rocks: readonly MapRock[];
  readonly comet: MapComet;
  readonly objects: readonly MapObject[];
  /** Minimap labels and icons. */
  readonly markers: readonly MapMarker[];
}

export const DEFAULT_STAR_LAYERS: readonly StarLayerSpec[] = [
  { kind: 'field', depth: -3200, tile: 5000, count: 2600, sizeWorld: 14, sizePx: 1.6, brightness: 0.55 },
  { kind: 'clusters', depth: -3800, tile: 6000, count: 1400, clusters: 7, sizeWorld: 17, sizePx: 1.8, brightness: 0.7 },
  { kind: 'field', depth: -4200, tile: 6500, count: 900, sizeWorld: 25, sizePx: 2.4, brightness: 0.9 },
  { kind: 'field', depth: -5200, tile: 8000, count: 180, sizeWorld: 42, sizePx: 3.4, brightness: 1.3 },
];

/**
 * Expand an authoring recipe into explicit rocks (map coordinates). Used by
 * the parser's `generate` sugar and by the default map; map editors can call
 * it directly and then hand-edit the result.
 */
export function generateMapRocks(recipe: MapRockGenerate, seed: number, size: number, spawn: { readonly x: number; readonly y: number }): MapRock[] {
  const half = size / 2;
  const w = (x: number, y: number): { x: number; z: number } => fromMapCoords(x, y, half);
  const spawnWorld = w(spawn.x, spawn.y);
  const specs = layoutToSpecs(
    {
      clusters: recipe.clusters.map((c) => ({ ...w(c.x, c.y), radius: c.radius, count: c.count, kind: c.kind, crystalChance: c.crystalChance })),
      giants: recipe.giants.map((g) => ({ ...w(g.x, g.y), radius: g.radius })),
      singles: [],
      scatter: recipe.scatter ? { ...recipe.scatter, keepClearX: spawnWorld.x, keepClearZ: spawnWorld.z } : null,
    },
    createRng(seed),
    half,
    recipe.respawn,
  );
  return specs.map((spec) => {
    const point = toMapCoords(spec.x, spec.z, half);
    return { id: spec.id, x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100, kind: spec.kind, radius: spec.radius, respawn: spec.respawnDelay };
  });
}

const STARTER_SEED = 20261003;
const STARTER_SIZE = 10000;
const STARTER_SPAWN = { x: 5000, y: 5000, heading: 0 };

/** The starter sector's rocks: the old procedural field, expanded once into explicit entries. */
const STARTER_ROCKS: readonly MapRock[] = generateMapRocks(
  {
    clusters: [{ x: 5620, y: 5460, radius: DEFAULT_ROCK_LAYOUT.clusters[0]!.radius, count: 55, kind: 'stone', crystalChance: 0.15 }],
    giants: [{ x: 5900, y: 5760, radius: 11 }],
    scatter: { clusters: 8, perCluster: 55, clusterRadius: 320, keepClear: 180, giants: 7 },
    respawn: DEFAULT_ROCK_RESPAWN,
  },
  STARTER_SEED,
  STARTER_SIZE,
  STARTER_SPAWN,
);

/**
 * The map the hangar starts in: a 500 by 500 proving ground you can cross
 * in seconds, with a dozen hand-placed rocks, one gas cloud, a cache and a
 * marker beacon. Everything is explicit; the bottom-left corner is left
 * clear because that is where the hangar parks the raider.
 */
export function provingGroundMapDefinition(): MapDefinition {
  const respawn = 60;
  const rock = (id: string, x: number, y: number, kind: RockKind, radius: number): MapRock => ({ id, x, y, kind, radius, respawn });
  return parseMapDefinition({
    name: 'Proving Ground',
    size: 500,
    seed: 7,
    spawn: { x: 250, y: 250, heading: 0 },
    scenery: {
      planets: [
        { art: 'planet-gas-02', x: 80, y: 440, depth: -2000, radius: 260, rotation: 0.4 },
        { art: 'moon-01', x: 410, y: 110, depth: -1700, radius: 60, rotation: 0 },
      ],
      sun: { x: -600, y: 700, depth: -7000, size: 5000 },
      nebulae: [{ art: 'nebula-02', x: 320, y: 280, depth: -6000, size: 6000, tint: '#2a5a8c', opacity: 0.45, rotation: 0.8 }],
      band: null,
    },
    rocks: [
      // North-east cluster.
      rock('ne-1', 330, 330, 'stone', 3),
      rock('ne-2', 352, 318, 'stone', 2.2),
      rock('ne-3', 345, 350, 'iron', 4),
      rock('ne-4', 372, 338, 'iron', 3),
      rock('ne-5', 360, 372, 'stone', 2.6),
      rock('ne-6', 338, 368, 'crystal', 2.4),
      // Ice to the west.
      rock('w-1', 110, 250, 'ice', 3.5),
      rock('w-2', 128, 275, 'ice', 2.6),
      rock('w-3', 95, 230, 'ice', 2.2),
      // South.
      rock('s-1', 260, 120, 'iron', 4.5),
      rock('s-2', 300, 105, 'stone', 2.5),
      rock('s-3', 320, 140, 'crystal', 3),
      // East and north.
      rock('e-1', 420, 250, 'stone', 3),
      rock('e-2', 440, 280, 'ice', 2.5),
      rock('n-1', 210, 420, 'stone', 2.8),
      { id: 'giant', x: 430, y: 110, kind: 'giant', radius: 10, respawn: null },
    ],
    comet: null,
    objects: [
      { type: 'gas-cloud', id: 'drift', x: 150, y: 390, radius: 45, damagePerSecond: 10 },
      { type: 'cache', x: 420, y: 430, resource: 'crystal', count: 4 },
      { type: 'beacon', id: 'north-marker', x: 250, y: 460, label: 'North Marker', description: 'Top of the proving ground', radius: 12 },
    ],
    markers: [
      { type: 'icon', x: 250, y: 250, icon: 'home', label: 'Spawn' },
      { type: 'icon', x: 350, y: 345, icon: 'mine', label: 'Iron field' },
      { type: 'icon', x: 320, y: 140, icon: 'crystal', label: 'Crystal vein' },
      { type: 'icon', x: 150, y: 390, icon: 'skull', label: 'The Drift' },
      { type: 'icon', x: 60, y: 60, icon: 'flag', label: "Raider's corner", colour: '#ff5c5c' },
      { type: 'icon', x: 420, y: 430, icon: 'shop', label: 'Crystal cache' },
      { type: 'icon', x: 445, y: 455, icon: 'quest', label: 'Navigator' },
      { type: 'label', x: 110, y: 255, text: 'Ice shelf', colour: '#bfe0f0' },
      { type: 'label', x: 430, y: 95, text: 'The Giant', colour: '#c9b59a' },
    ],
  });
}

/** The big 10,000 by 10,000 sector the prototype grew up in; also the source of parser defaults. */
export function defaultMapDefinition(): MapDefinition {
  return {
    version: 1,
    name: 'Starter Sector',
    size: STARTER_SIZE,
    seed: STARTER_SEED,
    spawn: STARTER_SPAWN,
    scenery: {
      stars: DEFAULT_STAR_LAYERS,
      planets: [
        { art: 'planet-gas-01', x: 4320, y: 5430, depth: -2400, radius: 380, rotation: 0.2 },
        { art: 'moon-01', x: 4480, y: 5300, depth: -2100, radius: 60, rotation: -0.3 },
        { art: 'planet-rock-01', x: 6700, y: 3600, depth: -2800, radius: 500, rotation: 0.4 },
        { art: 'planet-gas-02', x: 1800, y: 3200, depth: -2600, radius: 420, rotation: -0.1 },
        { art: 'moon-02', x: 2000, y: 3500, depth: -2000, radius: 70, rotation: 0.5 },
      ],
      sun: { x: 9500, y: 8500, depth: -7000, size: 7000 },
      nebulae: [
        { art: 'nebula-01', x: 8000, y: 9800, depth: -6000, size: 6500, tint: '#6a3fb0', opacity: 0.55, rotation: 0.8 },
        { art: 'nebula-02', x: 1500, y: 9000, depth: -6000, size: 5200, tint: '#2a7a8c', opacity: 0.55, rotation: 2.4 },
        { art: 'nebula-03', x: 12000, y: 2000, depth: -6000, size: 8000, tint: '#8c2a5a', opacity: 0.55, rotation: 4.1 },
        { art: 'nebula-01', x: -3000, y: 1500, depth: -6000, size: 7000, tint: '#2f5fa8', opacity: 0.55, rotation: 1.3 },
        { art: 'nebula-02', x: 5000, y: -4000, depth: -6000, size: 6000, tint: '#6a3fb0', opacity: 0.55, rotation: 5.0 },
        { art: 'nebula-03', x: 14000, y: 11000, depth: -6000, size: 8500, tint: '#2a7a8c', opacity: 0.55, rotation: 0.3 },
        { art: 'nebula-01', x: -2000, y: 13000, depth: -6000, size: 7500, tint: '#8c2a5a', opacity: 0.55, rotation: 3.3 },
        { art: 'nebula-02', x: 6500, y: 14500, depth: -6000, size: 5000, tint: '#2f5fa8', opacity: 0.55, rotation: 1.9 },
      ],
      band: { art: 'nebula-02', x: 3500, y: 7500, depth: -6500, width: 30600, height: 7200, tint: '#8fa6d8', opacity: 0.22, rotation: 0.55 },
    },
    rocks: STARTER_ROCKS,
    comet: { ...COMET_TUNING, enabled: true, firstNearStart: true },
    objects: [
      // Two hazards within easy reach of the spawn: a wide, slow-burning toxic cloud and a small, vicious ion haze.
      { type: 'gas-cloud', id: 'spore-drift', x: 4620, y: 5260, radius: 120, damagePerSecond: 10, label: 'Toxic gas', colour: '#9bff3d' },
      { type: 'gas-cloud', id: 'ion-haze', x: 5380, y: 4560, radius: 80, damagePerSecond: 18, label: 'Ion haze', colour: '#c76bff' },
    ],
    markers: [
      { type: 'icon', x: 5000, y: 5000, icon: 'home', label: 'Spawn', colour: null, onMinimap: true },
      { type: 'icon', x: 5620, y: 5460, icon: 'mine', label: 'Stone field', colour: null, onMinimap: true },
      { type: 'icon', x: 4620, y: 5260, icon: 'skull', label: 'Spore drift', colour: null, onMinimap: true },
      { type: 'label', x: 5000, y: 5700, text: 'STARTER SECTOR', colour: '#9fb3cc', size: 12, onMinimap: false },
    ],
  };
}

// ---- parsing ----------------------------------------------------------------

export class MapParseError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'MapParseError';
  }
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, path: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new MapParseError(path, 'expected a number');
  return value;
}

function str(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length === 0) throw new MapParseError(path, 'expected a non-empty string');
  return value;
}

function bool(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new MapParseError(path, 'expected true or false');
  return value;
}

function list(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new MapParseError(path, 'expected an array');
  return value;
}

function record(value: unknown, path: string): Json {
  if (!isRecord(value)) throw new MapParseError(path, 'expected an object');
  return value;
}

function rockKind(value: unknown, path: string): RockKind {
  if (typeof value !== 'string' || !(value in ROCK_KINDS)) throw new MapParseError(path, `expected one of ${Object.keys(ROCK_KINDS).join(', ')}`);
  return value as RockKind;
}

const RESOURCE_NAMES: readonly ResourceKind[] = ['ore', 'iron', 'ice', 'crystal'];

function resource(value: unknown, path: string): ResourceKind {
  if (typeof value !== 'string' || !RESOURCE_NAMES.includes(value as ResourceKind)) throw new MapParseError(path, `expected one of ${RESOURCE_NAMES.join(', ')}`);
  return value as ResourceKind;
}

/**
 * Validate a JSON payload into a MapDefinition. Missing sections fall back
 * to the starter sector's values (so a tiny payload with just a name and a
 * few rocks is a valid map); wrong types throw a MapParseError naming the
 * offending path.
 */
export function parseMapDefinition(input: unknown): MapDefinition {
  const base = defaultMapDefinition();
  const root = record(input, 'map');
  if (root['version'] !== undefined && root['version'] !== 1) throw new MapParseError('map.version', 'only version 1 is supported');
  const size = num(root['size'], 'map.size', base.size);
  if (size < 500) throw new MapParseError('map.size', 'must be at least 500');

  const spawnRaw = root['spawn'] === undefined ? {} : record(root['spawn'], 'map.spawn');
  const spawn = {
    x: num(spawnRaw['x'], 'map.spawn.x', size / 2),
    y: num(spawnRaw['y'], 'map.spawn.y', size / 2),
    heading: num(spawnRaw['heading'], 'map.spawn.heading', 0),
  };

  const sceneryRaw = root['scenery'] === undefined ? {} : record(root['scenery'], 'map.scenery');
  const scenery: MapScenery = {
    stars:
      sceneryRaw['stars'] === undefined
        ? base.scenery.stars
        : list(sceneryRaw['stars'], 'map.scenery.stars').map((item, i) => {
            const p = `map.scenery.stars[${i}]`;
            const r = record(item, p);
            const kind = r['kind'] === undefined ? 'field' : r['kind'];
            if (kind !== 'field' && kind !== 'clusters') throw new MapParseError(`${p}.kind`, 'expected "field" or "clusters"');
            return {
              kind,
              depth: num(r['depth'], `${p}.depth`),
              tile: num(r['tile'], `${p}.tile`, 5000),
              count: num(r['count'], `${p}.count`, 1000),
              ...(r['clusters'] !== undefined ? { clusters: num(r['clusters'], `${p}.clusters`) } : {}),
              sizeWorld: num(r['sizeWorld'], `${p}.sizeWorld`, 14),
              sizePx: num(r['sizePx'], `${p}.sizePx`, 1.6),
              brightness: num(r['brightness'], `${p}.brightness`, 0.6),
            };
          }),
    planets:
      sceneryRaw['planets'] === undefined
        ? base.scenery.planets
        : list(sceneryRaw['planets'], 'map.scenery.planets').map((item, i) => {
            const p = `map.scenery.planets[${i}]`;
            const r = record(item, p);
            return {
              art: str(r['art'], `${p}.art`),
              x: num(r['x'], `${p}.x`),
              y: num(r['y'], `${p}.y`),
              depth: num(r['depth'], `${p}.depth`, -2400),
              radius: num(r['radius'], `${p}.radius`, 300),
              rotation: num(r['rotation'], `${p}.rotation`, 0),
            };
          }),
    sun:
      sceneryRaw['sun'] === undefined
        ? base.scenery.sun
        : sceneryRaw['sun'] === null
          ? null
          : (() => {
              const r = record(sceneryRaw['sun'], 'map.scenery.sun');
              return { x: num(r['x'], 'map.scenery.sun.x'), y: num(r['y'], 'map.scenery.sun.y'), depth: num(r['depth'], 'map.scenery.sun.depth', -7000), size: num(r['size'], 'map.scenery.sun.size', 7000) };
            })(),
    nebulae:
      sceneryRaw['nebulae'] === undefined
        ? base.scenery.nebulae
        : list(sceneryRaw['nebulae'], 'map.scenery.nebulae').map((item, i) => {
            const p = `map.scenery.nebulae[${i}]`;
            const r = record(item, p);
            return {
              art: str(r['art'], `${p}.art`, 'nebula-01'),
              x: num(r['x'], `${p}.x`),
              y: num(r['y'], `${p}.y`),
              depth: num(r['depth'], `${p}.depth`, -6000),
              size: num(r['size'], `${p}.size`, 6000),
              tint: str(r['tint'], `${p}.tint`, '#6a3fb0'),
              opacity: num(r['opacity'], `${p}.opacity`, 0.55),
              rotation: num(r['rotation'], `${p}.rotation`, 0),
            };
          }),
    band:
      sceneryRaw['band'] === undefined
        ? base.scenery.band
        : sceneryRaw['band'] === null
          ? null
          : (() => {
              const r = record(sceneryRaw['band'], 'map.scenery.band');
              const p = 'map.scenery.band';
              return {
                art: str(r['art'], `${p}.art`, 'nebula-02'),
                x: num(r['x'], `${p}.x`),
                y: num(r['y'], `${p}.y`),
                depth: num(r['depth'], `${p}.depth`, -6500),
                width: num(r['width'], `${p}.width`, 30000),
                height: num(r['height'], `${p}.height`, 7000),
                tint: str(r['tint'], `${p}.tint`, '#8fa6d8'),
                opacity: num(r['opacity'], `${p}.opacity`, 0.22),
                rotation: num(r['rotation'], `${p}.rotation`, 0),
              };
            })(),
  };

  const seed = num(root['seed'], 'map.seed', base.seed);
  let rocks: readonly MapRock[];
  if (root['rocks'] === undefined) {
    rocks = base.rocks;
  } else if (Array.isArray(root['rocks'])) {
    const ids = new Set<string>();
    rocks = root['rocks'].map((item, i) => {
      const p = `map.rocks[${i}]`;
      const r = record(item, p);
      const id = str(r['id'], `${p}.id`, `rock-${String(i + 1).padStart(4, '0')}`);
      if (ids.has(id)) throw new MapParseError(`${p}.id`, `duplicate rock id "${id}"`);
      ids.add(id);
      const respawnRaw = r['respawn'];
      return {
        id,
        x: num(r['x'], `${p}.x`),
        y: num(r['y'], `${p}.y`),
        kind: r['kind'] === undefined ? 'stone' : rockKind(r['kind'], `${p}.kind`),
        radius: num(r['radius'], `${p}.radius`, 3),
        respawn: respawnRaw === null ? null : num(respawnRaw, `${p}.respawn`, DEFAULT_ROCK_RESPAWN),
      };
    });
  } else {
    const r = record(root['rocks'], 'map.rocks');
    const g = record(r['generate'], 'map.rocks.generate');
    const recipe: MapRockGenerate = {
      clusters: list(g['clusters'], 'map.rocks.generate.clusters').map((item, i) => {
        const p = `map.rocks.generate.clusters[${i}]`;
        const c = record(item, p);
        return {
          x: num(c['x'], `${p}.x`),
          y: num(c['y'], `${p}.y`),
          radius: num(c['radius'], `${p}.radius`, 300),
          count: num(c['count'], `${p}.count`, 40),
          kind: c['kind'] === undefined ? 'stone' : rockKind(c['kind'], `${p}.kind`),
          crystalChance: num(c['crystalChance'], `${p}.crystalChance`, 0),
        };
      }),
      giants: list(g['giants'], 'map.rocks.generate.giants').map((item, i) => {
        const p = `map.rocks.generate.giants[${i}]`;
        const c = record(item, p);
        return { x: num(c['x'], `${p}.x`), y: num(c['y'], `${p}.y`), radius: num(c['radius'], `${p}.radius`, 10) };
      }),
      scatter:
        g['scatter'] === undefined || g['scatter'] === null
          ? null
          : (() => {
              const c = record(g['scatter'], 'map.rocks.generate.scatter');
              const p = 'map.rocks.generate.scatter';
              return {
                clusters: num(c['clusters'], `${p}.clusters`, 6),
                perCluster: num(c['perCluster'], `${p}.perCluster`, 50),
                clusterRadius: num(c['clusterRadius'], `${p}.clusterRadius`, 320),
                keepClear: num(c['keepClear'], `${p}.keepClear`, 180),
                giants: num(c['giants'], `${p}.giants`, 5),
              };
            })(),
      respawn: g['respawn'] === null ? null : num(g['respawn'], 'map.rocks.generate.respawn', DEFAULT_ROCK_RESPAWN),
    };
    rocks = generateMapRocks(recipe, seed, size, spawn);
  }

  const cometRaw = root['comet'] === undefined ? undefined : root['comet'];
  let comet: MapComet = base.comet;
  if (cometRaw === null || cometRaw === false) comet = { ...base.comet, enabled: false };
  else if (cometRaw !== undefined) {
    const r = record(cometRaw, 'map.comet');
    comet = {
      enabled: bool(r['enabled'], 'map.comet.enabled', true),
      firstNearStart: bool(r['firstNearStart'], 'map.comet.firstNearStart', true),
      maxHp: num(r['maxHp'], 'map.comet.maxHp', COMET_TUNING.maxHp),
      radius: num(r['radius'], 'map.comet.radius', COMET_TUNING.radius),
      speed: num(r['speed'], 'map.comet.speed', COMET_TUNING.speed),
      startDistance: num(r['startDistance'], 'map.comet.startDistance', COMET_TUNING.startDistance),
      exitMargin: num(r['exitMargin'], 'map.comet.exitMargin', COMET_TUNING.exitMargin),
      respawnDelay: num(r['respawnDelay'], 'map.comet.respawnDelay', COMET_TUNING.respawnDelay),
      chunkEvery: num(r['chunkEvery'], 'map.comet.chunkEvery', COMET_TUNING.chunkEvery),
      chunkCrystalChance: num(r['chunkCrystalChance'], 'map.comet.chunkCrystalChance', COMET_TUNING.chunkCrystalChance),
      finalDrops:
        r['finalDrops'] === undefined
          ? COMET_TUNING.finalDrops
          : Object.fromEntries(Object.entries(record(r['finalDrops'], 'map.comet.finalDrops')).map(([k, v]) => [resource(k, `map.comet.finalDrops.${k}`), num(v, `map.comet.finalDrops.${k}`)])),
    };
  }

  const objects: MapObject[] = list(root['objects'], 'map.objects').map((item, i) => {
    const p = `map.objects[${i}]`;
    const r = record(item, p);
    const x = num(r['x'], `${p}.x`);
    const y = num(r['y'], `${p}.y`);
    switch (r['type']) {
      case 'cache':
        return { type: 'cache', x, y, resource: resource(r['resource'], `${p}.resource`), count: num(r['count'], `${p}.count`, 5) };
      case 'beacon':
        return {
          type: 'beacon',
          id: str(r['id'], `${p}.id`, `beacon-${i}`),
          x,
          y,
          label: str(r['label'], `${p}.label`, 'Beacon'),
          description: typeof r['description'] === 'string' ? r['description'] : '',
          colour: str(r['colour'], `${p}.colour`, '#6fd3ff'),
          radius: num(r['radius'], `${p}.radius`, 12),
        };
      case 'gas-cloud':
        return {
          type: 'gas-cloud',
          id: str(r['id'], `${p}.id`, `gas-${i}`),
          x,
          y,
          radius: num(r['radius'], `${p}.radius`, GAS_CLOUD_DEFAULTS.radius),
          damagePerSecond: num(r['damagePerSecond'], `${p}.damagePerSecond`, GAS_CLOUD_DEFAULTS.damagePerSecond),
          label: str(r['label'], `${p}.label`, GAS_CLOUD_DEFAULTS.label),
          colour: str(r['colour'], `${p}.colour`, GAS_CLOUD_DEFAULTS.colour),
        };
      default:
        throw new MapParseError(`${p}.type`, 'expected "cache", "beacon" or "gas-cloud" (rocks go in map.rocks)');
    }
  });

  const markers: MapMarker[] = list(root['markers'], 'map.markers').map((item, i) => {
    const p = `map.markers[${i}]`;
    const r = record(item, p);
    const x = num(r['x'], `${p}.x`);
    const y = num(r['y'], `${p}.y`);
    switch (r['type']) {
      case 'label':
        return {
          type: 'label',
          x,
          y,
          text: str(r['text'], `${p}.text`),
          colour: str(r['colour'], `${p}.colour`, LABEL_DEFAULTS.colour),
          size: num(r['size'], `${p}.size`, LABEL_DEFAULTS.size),
          onMinimap: bool(r['onMinimap'], `${p}.onMinimap`, false),
        };
      case 'icon': {
        const icon = str(r['icon'], `${p}.icon`);
        if (!(MAP_ICON_NAMES as readonly string[]).includes(icon)) throw new MapParseError(`${p}.icon`, `unknown icon "${icon}" (one of ${MAP_ICON_NAMES.join(', ')})`);
        return {
          type: 'icon',
          x,
          y,
          icon: icon as MapIconName,
          label: typeof r['label'] === 'string' ? r['label'] : '',
          colour: r['colour'] === undefined || r['colour'] === null ? null : str(r['colour'], `${p}.colour`),
          onMinimap: bool(r['onMinimap'], `${p}.onMinimap`, true),
        };
      }
      default:
        throw new MapParseError(`${p}.type`, 'expected "label" or "icon"');
    }
  });

  return {
    version: 1,
    name: str(root['name'], 'map.name', base.name),
    size,
    seed,
    spawn,
    scenery,
    rocks,
    comet,
    objects,
    markers,
  };
}

// ---- resolving --------------------------------------------------------------

export interface ResolvedPlanet {
  readonly art: string;
  readonly x: number;
  readonly z: number;
  readonly depth: number;
  readonly radius: number;
  readonly rotation: number;
}

export interface ResolvedSprite {
  readonly art: string;
  readonly x: number;
  readonly z: number;
  readonly depth: number;
  readonly size: number;
  readonly tint: string;
  readonly opacity: number;
  readonly rotation: number;
}

export interface ResolvedScenery {
  readonly stars: readonly StarLayerSpec[];
  readonly planets: readonly ResolvedPlanet[];
  readonly sun: { readonly x: number; readonly z: number; readonly depth: number; readonly size: number } | null;
  readonly nebulae: readonly ResolvedSprite[];
  readonly band: (ResolvedSprite & { readonly width: number; readonly height: number }) | null;
}

export interface ResolvedCache {
  readonly x: number;
  readonly z: number;
  readonly resource: ResourceKind;
  readonly count: number;
}

/** A map in world coordinates, ready for the simulation and the scene. */
export interface ResolvedMap {
  readonly name: string;
  readonly seed: number;
  readonly halfExtent: number;
  readonly spawn: { readonly x: number; readonly z: number; readonly heading: number };
  readonly scenery: ResolvedScenery;
  readonly rockSpecs: readonly RockSpec[];
  readonly comet: { readonly enabled: boolean; readonly firstNearStart: boolean; readonly tuning: CometTuning };
  readonly beacons: readonly Beacon[];
  readonly hazards: readonly Hazard[];
  readonly caches: readonly ResolvedCache[];
  readonly markers: readonly ResolvedMarker[];
}

/** A marker in world coordinates, ready for the minimap. */
export type ResolvedMarker =
  | { readonly type: 'label'; readonly x: number; readonly z: number; readonly text: string; readonly colour: string; readonly size: number; readonly onMinimap: boolean }
  | { readonly type: 'icon'; readonly x: number; readonly z: number; readonly icon: MapIconName; readonly label: string; readonly colour: string | null; readonly onMinimap: boolean };

export function resolveMap(def: MapDefinition): ResolvedMap {
  const half = def.size / 2;
  const w = (x: number, y: number): { x: number; z: number } => fromMapCoords(x, y, half);
  const spawn = w(def.spawn.x, def.spawn.y);
  const { enabled, firstNearStart, ...tuning } = def.comet;
  return {
    name: def.name,
    seed: def.seed,
    halfExtent: half,
    spawn: { ...spawn, heading: def.spawn.heading },
    scenery: {
      stars: def.scenery.stars,
      planets: def.scenery.planets.map((planet) => ({ art: planet.art, ...w(planet.x, planet.y), depth: planet.depth, radius: planet.radius, rotation: planet.rotation })),
      sun: def.scenery.sun ? { ...w(def.scenery.sun.x, def.scenery.sun.y), depth: def.scenery.sun.depth, size: def.scenery.sun.size } : null,
      nebulae: def.scenery.nebulae.map((n) => ({ art: n.art, ...w(n.x, n.y), depth: n.depth, size: n.size, tint: n.tint, opacity: n.opacity, rotation: n.rotation })),
      band: def.scenery.band
        ? { art: def.scenery.band.art, ...w(def.scenery.band.x, def.scenery.band.y), depth: def.scenery.band.depth, size: def.scenery.band.width, width: def.scenery.band.width, height: def.scenery.band.height, tint: def.scenery.band.tint, opacity: def.scenery.band.opacity, rotation: def.scenery.band.rotation }
        : null,
    },
    rockSpecs: def.rocks.map((rock) => ({ id: rock.id, kind: rock.kind, ...w(rock.x, rock.y), radius: rock.radius, respawnDelay: rock.respawn })),
    comet: { enabled, firstNearStart, tuning },
    beacons: def.objects.flatMap((o) =>
      o.type === 'beacon' ? [{ id: o.id, ...w(o.x, o.y), label: o.label, description: o.description, colour: o.colour, radius: o.radius }] : [],
    ),
    hazards: def.objects.flatMap((o) =>
      o.type === 'gas-cloud' ? [{ id: o.id, kind: 'gas' as const, ...w(o.x, o.y), radius: o.radius, label: o.label, colour: o.colour, damagePerSecond: o.damagePerSecond }] : [],
    ),
    caches: def.objects.flatMap((o) => (o.type === 'cache' ? [{ ...w(o.x, o.y), resource: o.resource, count: o.count }] : [])),
    markers: def.markers.map((m) => (m.type === 'label' ? { ...m, ...w(m.x, m.y) } : { ...m, ...w(m.x, m.y) })),
  };
}

export function defaultResolvedMap(): ResolvedMap {
  return resolveMap(defaultMapDefinition());
}
