import type { FlightState } from './flightController';
import type { ResourceKind } from './loot';
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
  /** Multiplier on the size-based health. */
  readonly toughness: number;
  /** Instance colours the renderer picks from. */
  readonly colours: readonly string[];
  /** Crystal rocks carry glowing gem nodes. */
  readonly gems?: string;
  /** What breaking one yields, for tooltips. */
  readonly resources: readonly ResourceKind[];
}

export const ROCK_KINDS: Readonly<Record<RockKind, RockKindInfo>> = {
  stone: { label: 'Stone', toughness: 1, colours: ['#7d7467', '#6e675e', '#8a7a68', '#5f5a55'], resources: ['ore'] },
  iron: { label: 'Iron', toughness: 1.6, colours: ['#4f535c', '#5b5f68', '#43474f', '#6a6e78'], resources: ['iron', 'ore'] },
  ice: { label: 'Ice', toughness: 0.7, colours: ['#bfe0f0', '#a9d2e8', '#d4ecf7', '#9cc6dd'], resources: ['ice'] },
  crystal: { label: 'Crystal', toughness: 1.3, colours: ['#5a4a7a', '#6b5690', '#4c3f6b'], gems: '#c9a6ff', resources: ['crystal', 'ore'] },
  giant: { label: 'Giant', toughness: 1.4, colours: ['#5c5247', '#4e463e', '#6b5f52'], resources: ['ore', 'iron', 'crystal'] },
};

export interface Rock {
  readonly id: number;
  readonly kind: RockKind;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly maxHp: number;
  /** Remaining health in damage points. */
  hp: number;
  /** Fixed yaw for the visual. */
  readonly rotation: number;
  /** Per-rock variation hook for the renderer (shape tilt, colour). */
  readonly seed: number;
}

export interface RockHit {
  readonly rock: Rock;
  readonly destroyed: boolean;
}

export interface RockFieldOptions {
  readonly clusters: number;
  readonly perCluster: number;
  readonly clusterRadius: number;
  /** No rocks spawn within this distance of the origin, where the ship starts. */
  readonly keepClear: number;
  readonly giants: number;
}

export const DEFAULT_ROCK_FIELD: RockFieldOptions = { clusters: 9, perCluster: 55, clusterRadius: 320, keepClear: 180, giants: 7 };

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
export function dropsFor(rock: Rock, rng: Rng, bonus = 1): Drops {
  const r = rock.radius;
  const scaled = (value: number): number => Math.max(1, Math.round(value * bonus));
  switch (rock.kind) {
    case 'stone':
      return { ore: scaled(r * 1.2) };
    case 'iron':
      return { iron: scaled(r * 1.0), ore: scaled(r * 0.4) };
    case 'ice':
      return { ice: scaled(r * 1.3) };
    case 'crystal':
      return { crystal: scaled(r * 0.7), ore: scaled(r * 0.4) };
    case 'giant': {
      const drops: Drops = { ore: scaled(r * 2.5), iron: scaled(r * 1.0) };
      if (rng() < 0.6) drops.crystal = scaled(1 + rng() * 2);
      return drops;
    }
  }
}

export class RockField {
  readonly rocks: Rock[];
  brokenCount = 0;
  private grid = new Map<string, Rock[]>();
  private indexDirty = true;

  constructor(rocks: Rock[]) {
    this.rocks = rocks;
  }

  /**
   * Deterministic field: dense clusters, each dominated by one kind (an iron
   * belt, an ice field, a crystal pocket), plus a few giants scattered about.
   * The first cluster is close to the start and seeded with some crystal.
   */
  static generate(rng: Rng, halfExtent: number, options: RockFieldOptions = DEFAULT_ROCK_FIELD): RockField {
    // The first clusters guarantee one of each kind; the rest are a weighted mix.
    const guaranteed: RockKind[] = ['stone', 'iron', 'ice', 'crystal'];
    const weighted: RockKind[] = ['stone', 'stone', 'iron', 'iron', 'ice', 'ice', 'crystal'];
    const centres: Array<[number, number, RockKind]> = [[-620, 460, 'stone']];
    while (centres.length < options.clusters) {
      const x = range(rng, -halfExtent * 0.9, halfExtent * 0.9);
      const z = range(rng, -halfExtent * 0.9, halfExtent * 0.9);
      if (Math.hypot(x, z) <= options.keepClear + options.clusterRadius) continue;
      const kind = centres.length < guaranteed.length ? guaranteed[centres.length]! : pick(rng, weighted);
      centres.push([x, z, kind]);
    }
    const rocks: Rock[] = [];
    let id = 1;
    const make = (kind: RockKind, x: number, z: number, radius: number): Rock => {
      const maxHp = hitPointsFor(radius, kind);
      return { id: id++, kind, x, z, radius, maxHp, hp: maxHp, rotation: rng() * Math.PI * 2, seed: rng() };
    };
    centres.forEach(([cx, cz, dominant], index) => {
      for (let i = 0; i < options.perCluster; i++) {
        const angle = rng() * Math.PI * 2;
        const distance = Math.sqrt(rng()) * options.clusterRadius;
        const x = cx + Math.cos(angle) * distance;
        const z = cz + Math.sin(angle) * distance;
        if (Math.hypot(x, z) < options.keepClear) continue;
        const roll = rng();
        let kind: RockKind = roll < 0.72 ? dominant : 'stone';
        if (index === 0 && roll > 0.85) kind = 'crystal';
        const radius = kind === 'crystal' ? range(rng, 1.8, 4.2) : kind === 'iron' ? range(rng, 1.6, 5.8) : range(rng, 1.3, 5.5);
        rocks.push(make(kind, x, z, radius));
      }
    });
    let placed = 0;
    while (placed < options.giants) {
      const x = range(rng, -halfExtent * 0.85, halfExtent * 0.85);
      const z = range(rng, -halfExtent * 0.85, halfExtent * 0.85);
      if (Math.hypot(x, z) < options.keepClear + 120) continue;
      rocks.push(make('giant', x, z, range(rng, 8, 13)));
      placed++;
    }
    // One giant within sight of the first cluster so it is easy to find.
    rocks.push(make('giant', -900, 760, 11));
    return new RockField(rocks);
  }

  /** The rock containing the point, if any. */
  findAt(x: number, z: number): Rock | null {
    return this.nearby(x, z, 0).find((rock) => Math.hypot(rock.x - x, rock.z - z) <= rock.radius) ?? null;
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

  /** Take `amount` off a rock's health; a rock at zero is removed. */
  damage(rock: Rock, amount: number, _rng?: Rng): RockHit {
    rock.hp = Math.max(0, rock.hp - Math.max(0, amount));
    if (rock.hp > 0) return { rock, destroyed: false };
    const index = this.rocks.indexOf(rock);
    if (index >= 0) this.rocks.splice(index, 1);
    this.brokenCount += 1;
    this.indexDirty = true;
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
