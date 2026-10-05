import type { FlightState } from './flightController';
import type { ResourceKind } from './loot';
import { rayCircle } from './beam';
import { pick, range, type Rng } from './random';

/**
 * Asteroids on the ship plane. They never move: each has a fixed position
 * and yaw and a pool of health that weapons chip away; at zero it vanishes
 * and drops resources. Sizes vary from small lumps to giants. Pure logic
 * with a lazily rebuilt grid for hit tests.
 */

export type RockKind = 'stone' | 'iron' | 'ice' | 'crystal' | 'giant';

export interface RockKindInfo {
  readonly label: string;
  /** One line for Examine. */
  readonly description: string;
  /** Multiplier on the size-based health. */
  readonly toughness: number;
  /** Instance colours the renderer picks from. */
  readonly colours: readonly string[];
  /** Crystal rocks carry glowing gem nodes. */
  readonly gems?: string;
  /** What breaking one yields, for tooltips. */
  /** What breaking one yields: item counts scale with the rock's radius. */
  readonly drops: readonly RockDrop[];
}

/**
 * One line of a rock's drop table: `item` per unit of radius (`perRadius`),
 * plus an optional flat roll (`flat` min..max), gated by `chance`.
 */
export interface RockDrop {
  readonly item: ResourceKind;
  readonly perRadius?: number;
  readonly flat?: readonly [number, number];
  readonly chance?: number;
}

export const ROCK_KINDS: Readonly<Record<RockKind, RockKindInfo>> = {
  stone: { label: 'Stone', description: 'Common asteroid rock.', toughness: 1, colours: ['#7d7467', '#6e675e', '#8a7a68', '#5f5a55'], drops: [{ item: 'stone', perRadius: 1.2 }] },
  iron: { label: 'Iron', description: 'Dark, dense rock veined with metal.', toughness: 1.6, colours: ['#4f535c', '#5b5f68', '#43474f', '#6a6e78'], drops: [{ item: 'iron-ore', perRadius: 1.0 }, { item: 'stone', perRadius: 0.4 }] },
  ice: { label: 'Ice', description: 'A brittle lump of dirty ice.', toughness: 0.7, colours: ['#bfe0f0', '#a9d2e8', '#d4ecf7', '#9cc6dd'], drops: [{ item: 'ice', perRadius: 1.3 }] },
  crystal: { label: 'Crystal', description: 'Violet rock studded with glowing crystal.', toughness: 1.3, colours: ['#5a4a7a', '#6b5690', '#4c3f6b'], gems: '#c9a6ff', drops: [{ item: 'crystal', perRadius: 0.7 }, { item: 'stone', perRadius: 0.4 }] },
  giant: {
    label: 'Giant',
    description: 'A mountain of a rock. It will take a while.',
    toughness: 1.4,
    colours: ['#5c5247', '#4e463e', '#6b5f52'],
    drops: [{ item: 'stone', perRadius: 2.5 }, { item: 'iron-ore', perRadius: 1.0 }, { item: 'crystal', flat: [1, 3], chance: 0.6 }],
  },
};

/** The distinct items a rock kind can drop, for tooltips. */
export function rockDropItems(kind: RockKind): ResourceKind[] {
  return [...new Set(ROCK_KINDS[kind].drops.map((drop) => drop.item))];
}

/** A rock as a map defines it: fixed position, kind, size, and whether it comes back. */
export interface RockSpec {
  /** Stable id a server can key state on, e.g. "rock-0042". */
  readonly id: string;
  readonly kind: RockKind;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** Seconds after being mined out before it reappears; null means gone for good. */
  readonly respawnDelay: number | null;
}

export interface Rock extends RockSpec {
  readonly maxHp: number;
  /** Remaining health in damage points; 0 while destroyed and waiting to respawn. */
  hp: number;
  /** Fixed yaw for the visual, derived from the id. */
  readonly rotation: number;
  /** Per-rock variation hook for the renderer (shape tilt, colour), derived from the id. */
  readonly seed: number;
}

/** The dynamic part of a rock, as a server would stream it for rocks in view. */
export interface RockSnapshot {
  readonly id: string;
  readonly kind: RockKind;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly hp: number;
  readonly maxHp: number;
}

export interface RockHit {
  readonly rock: Rock;
  readonly destroyed: boolean;
}

/** Deterministic value in [0, 1) from a string, so visuals need no extra data per rock. */
export function hashToUnit(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export function rockFromSpec(spec: RockSpec): Rock {
  const maxHp = hitPointsFor(spec.radius, spec.kind);
  return { ...spec, maxHp, hp: maxHp, rotation: hashToUnit(`${spec.id}:rot`) * Math.PI * 2, seed: hashToUnit(`${spec.id}:seed`) };
}

export const DEFAULT_ROCK_RESPAWN = 120;

/** True once a rock has lost any health; an untouched or freshly respawned rock is not damaged. */
export function isDamaged(rock: { readonly hp: number; readonly maxHp: number }): boolean {
  return rock.hp < rock.maxHp;
}

export interface RockClusterSpec {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly count: number;
  /** Dominant kind; about a quarter of the rocks are plain stone regardless. */
  readonly kind: RockKind;
  /** Chance that a rock is crystal instead of its kind. */
  readonly crystalChance: number;
}

export interface RockGiantSpec {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface RockSingleSpec {
  readonly x: number;
  readonly z: number;
  readonly kind: RockKind;
  readonly radius: number;
}

/** Seeded random fill: clusters (one of each kind first, then a weighted mix) and lone giants. */
export interface RockScatterSpec {
  readonly clusters: number;
  readonly perCluster: number;
  readonly clusterRadius: number;
  /** No scattered rocks within this distance of (keepClearX, keepClearZ). */
  readonly keepClear: number;
  readonly keepClearX: number;
  readonly keepClearZ: number;
  readonly giants: number;
}

/** An authoring recipe that expands into explicit rock specs; never used at runtime directly. */
export interface RockLayout {
  readonly clusters: readonly RockClusterSpec[];
  readonly giants: readonly RockGiantSpec[];
  readonly singles: readonly RockSingleSpec[];
  readonly scatter: RockScatterSpec | null;
}

/** The starter sector's field: an explicit stone-and-crystal cluster and a giant near the start, plus a seeded scatter. */
export const DEFAULT_ROCK_LAYOUT: RockLayout = {
  clusters: [{ x: -620, z: 460, radius: 320, count: 55, kind: 'stone', crystalChance: 0.15 }],
  giants: [{ x: -900, z: 760, radius: 11 }],
  singles: [],
  scatter: { clusters: 8, perCluster: 55, clusterRadius: 320, keepClear: 180, keepClearX: 0, keepClearZ: 0, giants: 7 },
};

const GRID_CELL = 48;
/** How much sideways speed survives scraping along a rock. */
const SCRAPE_FRICTION = 0.6;
/** Hover picking is a little generous so the visual rock is easy to point at. */
const HOVER_MARGIN = 1.15;

/** Health from size, scaled by the kind's toughness. Giants are a project. */
export function hitPointsFor(radius: number, kind: RockKind = 'stone'): number {
  const base = kind === 'giant' ? 40 + radius * 18 : 10 + radius * 12;
  return Math.max(1, Math.round(base * ROCK_KINDS[kind].toughness));
}

export type Drops = Partial<Record<ResourceKind, number>>;

/** What a rock yields when it shatters; `bonus` scales it (mining tools). */
/** Roll a rock's drop table: each line yields its items scaled by radius and the mining bonus, at least one when it fires. */
export function dropsFor(rock: Rock, rng: Rng, bonus = 1): Drops {
  const drops: Drops = {};
  for (const line of ROCK_KINDS[rock.kind].drops) {
    if (line.chance !== undefined && rng() >= line.chance) continue;
    const base = (line.perRadius ?? 0) * rock.radius + (line.flat ? line.flat[0] + rng() * (line.flat[1] - line.flat[0]) : 0);
    const count = Math.max(1, Math.round(base * bonus));
    drops[line.item] = (drops[line.item] ?? 0) + count;
  }
  return drops;
}

/**
 * Expand a layout into explicit rock specs: clusters, giants and single
 * rocks, then an optional seeded scatter that keeps clear of the spawn.
 * Ids are assigned in order ("rock-0001", ...) so the same layout and seed
 * always yield the same rocks; the result is what gets saved into a map.
 */
export function layoutToSpecs(layout: RockLayout, rng: Rng, halfExtent: number, respawnDelay: number | null = DEFAULT_ROCK_RESPAWN): RockSpec[] {
  const specs: RockSpec[] = [];
  const add = (kind: RockKind, x: number, z: number, radius: number): void => {
    specs.push({ id: `rock-${String(specs.length + 1).padStart(4, '0')}`, kind, x, z, radius, respawnDelay });
  };
  const inBounds = (x: number, z: number): boolean => Math.abs(x) <= halfExtent && Math.abs(z) <= halfExtent;
  const fillCluster = (spec: RockClusterSpec, avoid: { x: number; z: number; radius: number } | null): void => {
    for (let i = 0; i < spec.count; i++) {
      const angle = rng() * Math.PI * 2;
      const distance = Math.sqrt(rng()) * spec.radius;
      const x = spec.x + Math.cos(angle) * distance;
      const z = spec.z + Math.sin(angle) * distance;
      if (!inBounds(x, z)) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < avoid.radius) continue;
      const roll = rng();
      let kind: RockKind = roll < 0.72 ? spec.kind : 'stone';
      if (roll > 1 - spec.crystalChance) kind = 'crystal';
      const radius = kind === 'crystal' ? range(rng, 1.8, 4.2) : kind === 'iron' ? range(rng, 1.6, 5.8) : range(rng, 1.3, 5.5);
      add(kind, round2(x), round2(z), round2(radius));
    }
  };

  const scatter = layout.scatter;
  const avoid = scatter ? { x: scatter.keepClearX, z: scatter.keepClearZ, radius: scatter.keepClear } : null;
  for (const cluster of layout.clusters) fillCluster(cluster, avoid);
  for (const giant of layout.giants) add('giant', giant.x, giant.z, giant.radius);
  for (const single of layout.singles) add(single.kind, single.x, single.z, single.radius);

  if (scatter) {
    const guaranteed: RockKind[] = ['stone', 'iron', 'ice', 'crystal'];
    const weighted: RockKind[] = ['stone', 'stone', 'iron', 'iron', 'ice', 'ice', 'crystal'];
    let placed = 0;
    let attempts = 0;
    while (placed < scatter.clusters && attempts < scatter.clusters * 50) {
      attempts++;
      const x = range(rng, -halfExtent * 0.9, halfExtent * 0.9);
      const z = range(rng, -halfExtent * 0.9, halfExtent * 0.9);
      if (Math.hypot(x - scatter.keepClearX, z - scatter.keepClearZ) <= scatter.keepClear + scatter.clusterRadius) continue;
      const kind = placed < guaranteed.length ? guaranteed[placed]! : pick(rng, weighted);
      fillCluster({ x, z, radius: scatter.clusterRadius, count: scatter.perCluster, kind, crystalChance: 0 }, avoid);
      placed++;
    }
    let giants = 0;
    attempts = 0;
    while (giants < scatter.giants && attempts < scatter.giants * 50) {
      attempts++;
      const x = range(rng, -halfExtent * 0.85, halfExtent * 0.85);
      const z = range(rng, -halfExtent * 0.85, halfExtent * 0.85);
      if (Math.hypot(x - scatter.keepClearX, z - scatter.keepClearZ) < scatter.keepClear + 120) continue;
      add('giant', round2(x), round2(z), round2(range(rng, 8, 13)));
      giants++;
    }
  }
  return specs;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * All the rocks of a map, every one defined up front with a stable id.
 * Alive rocks are in `rocks`; destroyed ones keep their record (hp 0) and
 * come back after their respawn delay. A server keeps exactly this and
 * streams `snapshot()` for rocks near each player.
 */
export class RockField {
  /** Rocks currently alive, the ones that collide, block shots and can be mined. */
  readonly rocks: Rock[] = [];
  brokenCount = 0;
  private readonly byId = new Map<string, Rock>();
  private readonly respawns = new Map<string, number>();
  private grid = new Map<string, Rock[]>();
  private indexDirty = true;

  constructor(specs: readonly RockSpec[]) {
    for (const spec of specs) {
      if (this.byId.has(spec.id)) throw new Error(`Duplicate rock id "${spec.id}"`);
      const rock = rockFromSpec(spec);
      this.byId.set(rock.id, rock);
      this.rocks.push(rock);
    }
  }

  /** The starter sector's field. */
  static generate(rng: Rng, halfExtent: number): RockField {
    return new RockField(layoutToSpecs(DEFAULT_ROCK_LAYOUT, rng, halfExtent));
  }

  /** Every rock the map defines, alive or not. Positions never change, so this is the static map. */
  get defined(): IterableIterator<Rock> {
    return this.byId.values();
  }

  get(id: string): Rock | undefined {
    return this.byId.get(id);
  }

  /** Bring back rocks whose respawn time has passed; returns them. */
  step(now: number): Rock[] {
    const respawned: Rock[] = [];
    for (const [id, at] of this.respawns) {
      if (now < at) continue;
      const rock = this.byId.get(id);
      this.respawns.delete(id);
      if (!rock) continue;
      rock.hp = rock.maxHp;
      this.rocks.push(rock);
      this.indexDirty = true;
      respawned.push(rock);
    }
    return respawned;
  }

  /** Alive rocks within a radius of a point: what a server would send a player at that point. */
  inView(x: number, z: number, radius: number): Rock[] {
    return this.overlapping(x, z, radius);
  }

  /**
   * Alive rocks in view that have taken damage. Whether a rock shows a health
   * bar is decided by this shared state alone, not by who shot it, so every
   * player with the rock in view sees the same bar at the same moment.
   */
  damagedInView(x: number, z: number, radius: number): Rock[] {
    return this.inView(x, z, radius).filter(isDamaged);
  }

  snapshot(x: number, z: number, radius: number): RockSnapshot[] {
    return this.inView(x, z, radius).map((rock) => ({ id: rock.id, kind: rock.kind, x: rock.x, z: rock.z, radius: rock.radius, hp: rock.hp, maxHp: rock.maxHp }));
  }

  /** The rock containing the point, if any. */
  findAt(x: number, z: number): Rock | null {
    return this.nearby(x, z, 0).find((rock) => Math.hypot(rock.x - x, rock.z - z) <= rock.radius) ?? null;
  }

  /**
   * The first alive rock a segment from (x0, z0) to (x1, z1) passes through,
   * with the entry point. Projectiles use this with their previous position so
   * a fast shot (or a slow frame) cannot step clean over a small rock.
   */
  firstAlong(x0: number, z0: number, x1: number, z1: number): { readonly rock: Rock; readonly x: number; readonly z: number } | null {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) {
      const rock = this.findAt(x1, z1);
      return rock ? { rock, x: x1, z: z1 } : null;
    }
    const ux = dx / length;
    const uz = dz / length;
    let best: Rock | null = null;
    let bestT = Infinity;
    // Rocks sit in every grid cell they overlap, so the segment's bounding box finds all candidates.
    for (const rock of this.nearby((x0 + x1) / 2, (z0 + z1) / 2, length / 2)) {
      const t = rayCircle(x0, z0, ux, uz, rock.x, rock.z, rock.radius);
      if (t !== null && t <= length && t < bestT) {
        bestT = t;
        best = rock;
      }
    }
    return best ? { rock: best, x: x0 + ux * bestT, z: z0 + uz * bestT } : null;
  }

  /** The rock under a hovering cursor: closest centre among those within a generous radius. */
  hoverAt(x: number, z: number): Rock | null {
    let best: Rock | null = null;
    let bestDistance = Infinity;
    for (const rock of this.nearby(x, z, 8)) {
      const distance = Math.hypot(rock.x - x, rock.z - z);
      if (distance <= rock.radius * HOVER_MARGIN && distance < bestDistance) {
        best = rock;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Rocks whose circles overlap a circle at (x, z) of `radius`. */
  overlapping(x: number, z: number, radius: number): Rock[] {
    return this.nearby(x, z, radius).filter((rock) => Math.hypot(rock.x - x, rock.z - z) < rock.radius + radius);
  }

  /** Take `amount` off a rock's health; at zero it is removed and scheduled to respawn if the map says so. */
  damage(rock: Rock, amount: number, now = 0): RockHit {
    rock.hp = Math.max(0, rock.hp - Math.max(0, amount));
    if (rock.hp > 0) return { rock, destroyed: false };
    const index = this.rocks.indexOf(rock);
    if (index >= 0) this.rocks.splice(index, 1);
    this.brokenCount += 1;
    this.indexDirty = true;
    if (rock.respawnDelay !== null) this.respawns.set(rock.id, now + rock.respawnDelay);
    return { rock, destroyed: true };
  }

  /** Push the ship out of any rock it overlaps and stop it there. */
  collideShip(state: FlightState, shipRadius: number): FlightState {
    return this.resolveShipCollision(state, shipRadius).state;
  }

  /**
   * Like `collideShip`, also reporting the hardest approach speed for
   * damage. Rocks are immovable: the ship loses all speed into the rock and
   * most of its speed along it, so it stops rather than bouncing off.
   */
  resolveShipCollision(state: FlightState, shipRadius: number): { state: FlightState; impactSpeed: number } {
    let { x, z, vx, vz } = state;
    let impactSpeed = 0;
    for (const rock of this.overlapping(x, z, shipRadius)) {
      const dx = x - rock.x;
      const dz = z - rock.z;
      const distance = Math.hypot(dx, dz) || 1e-6;
      const nx = dx / distance;
      const nz = dz / distance;
      const penetration = rock.radius + shipRadius - distance;
      x += nx * penetration;
      z += nz * penetration;
      const approach = vx * nx + vz * nz;
      if (approach < 0) {
        impactSpeed = Math.max(impactSpeed, -approach);
        vx -= approach * nx;
        vz -= approach * nz;
        vx *= SCRAPE_FRICTION;
        vz *= SCRAPE_FRICTION;
      }
    }
    return { state: { ...state, x, z, vx, vz }, impactSpeed };
  }

  private rebuildIndex(): void {
    this.grid = new Map();
    for (const rock of this.rocks) {
      const minCx = Math.floor((rock.x - rock.radius) / GRID_CELL);
      const maxCx = Math.floor((rock.x + rock.radius) / GRID_CELL);
      const minCz = Math.floor((rock.z - rock.radius) / GRID_CELL);
      const maxCz = Math.floor((rock.z + rock.radius) / GRID_CELL);
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = `${cx},${cz}`;
          const bucket = this.grid.get(key);
          if (bucket) bucket.push(rock);
          else this.grid.set(key, [rock]);
        }
      }
    }
    this.indexDirty = false;
  }

  private nearby(x: number, z: number, radius: number): Rock[] {
    if (this.indexDirty) this.rebuildIndex();
    const seen = new Set<Rock>();
    const minCx = Math.floor((x - radius) / GRID_CELL);
    const maxCx = Math.floor((x + radius) / GRID_CELL);
    const minCz = Math.floor((z - radius) / GRID_CELL);
    const maxCz = Math.floor((z + radius) / GRID_CELL);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        for (const rock of this.grid.get(`${cx},${cz}`) ?? []) seen.add(rock);
      }
    }
    return [...seen];
  }
}
