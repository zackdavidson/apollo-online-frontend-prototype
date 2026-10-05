import { RESOURCE_KINDS, defaultItemCatalog, type ResourceKind } from './items';
import { range, type Rng } from './random';

/**
 * Dropped items and the stacks that carry them. Which items exist, what
 * they are called and what they look like comes from the item catalog;
 * this file only places and collects them. A dropped stack sits where it
 * fell, old-school style: no drift, no magnet. A collector that comes
 * within reach takes the whole stack and it vanishes.
 */

export { RESOURCE_KINDS, type ResourceKind };

export interface ResourceInfo {
  readonly label: string;
  readonly colour: string;
  /** Rough worth, for a score line. */
  readonly value: number;
}

/** Display facts for each stackable resource, straight from the item catalog. */
export const RESOURCES: Readonly<Record<ResourceKind, ResourceInfo>> = Object.fromEntries(
  RESOURCE_KINDS.map((kind) => {
    const item = defaultItemCatalog().require(kind);
    return [kind, { label: item.name, colour: item.visual.colour, value: item.value }];
  }),
) as Record<ResourceKind, ResourceInfo>;

export type Inventory = Record<ResourceKind, number>;

export function emptyInventory(): Inventory {
  return Object.fromEntries(RESOURCE_KINDS.map((kind) => [kind, 0])) as Inventory;
}

export function inventoryValue(inventory: Inventory): number {
  return RESOURCE_KINDS.reduce((total, kind) => total + inventory[kind] * RESOURCES[kind].value, 0);
}

export interface Pickup {
  readonly id: number;
  readonly kind: ResourceKind;
  /** How many of the item this stack holds; collecting it takes them all. */
  readonly count: number;
  readonly x: number;
  readonly z: number;
  /** Seconds left before it fades away. */
  life: number;
  readonly phase: number;
  /**
   * Whether walking over it collects it. A stack the player dropped starts
   * disarmed and arms once they have moved away, so dropping is not undone
   * on the spot. "Take" ignores this.
   */
  armed: boolean;
}

export interface LootTuning {
  readonly lifetime: number;
  /** Reach beyond the collector's radius within which a stack is picked up. */
  readonly reach: number;
  readonly maxPickups: number;
}

export const DEFAULT_LOOT_TUNING: LootTuning = { lifetime: 45, reach: 3, maxPickups: 400 };

export interface Collector {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export class LootField {
  readonly pickups: Pickup[] = [];
  private nextId = 1;

  constructor(
    private readonly rng: Rng,
    private readonly tuning: LootTuning = DEFAULT_LOOT_TUNING,
  ) {}

  /** Drop one stack of `count` × `kind` beside a point. `Infinity` lifetime makes a permanent cache. */
  spawn(x: number, z: number, kind: ResourceKind, count: number, lifetime: number = this.tuning.lifetime, options: { readonly armed?: boolean } = {}): Pickup | null {
    if (count <= 0 || this.pickups.length >= this.tuning.maxPickups) return null;
    const angle = this.rng() * Math.PI * 2;
    const distance = range(this.rng, 0.4, 1.6);
    const pickup: Pickup = {
      id: this.nextId++,
      kind,
      count: Math.round(count),
      x: x + Math.cos(angle) * distance,
      z: z + Math.sin(angle) * distance,
      life: lifetime === Infinity ? Infinity : lifetime * range(this.rng, 0.85, 1.0),
      phase: this.rng() * Math.PI * 2,
      armed: options.armed ?? true,
    };
    this.pickups.push(pickup);
    return pickup;
  }

  /** The stack under a hovering cursor: nearest within a generous radius, or null. */
  at(x: number, z: number, radius = 1.8): Pickup | null {
    let best: Pickup | null = null;
    let bestDistance = radius;
    for (const pickup of this.pickups) {
      const distance = Math.hypot(pickup.x - x, pickup.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pickup;
      }
    }
    return best;
  }

  get(id: number): Pickup | undefined {
    return this.pickups.find((pickup) => pickup.id === id);
  }

  /** Deliberately take a stack (the "Take" option): removed if within `maxDistance` of the collector, armed or not. */
  take(id: number, collector: Collector, maxDistance: number): Pickup | null {
    const index = this.pickups.findIndex((pickup) => pickup.id === id);
    const pickup = this.pickups[index];
    if (!pickup || Math.hypot(pickup.x - collector.x, pickup.z - collector.z) > maxDistance) return null;
    this.removeAt(index);
    return pickup;
  }

  /** Age stacks away and collect the armed ones the collector is standing on. */
  step(dt: number, collector: Collector | null): Partial<Record<ResourceKind, number>> {
    const collected: Partial<Record<ResourceKind, number>> = {};
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.removeAt(i);
        continue;
      }
      if (!collector) continue;
      const distance = Math.hypot(collector.x - p.x, collector.z - p.z);
      const within = distance <= collector.radius + this.tuning.reach;
      if (!within) {
        p.armed = true;
      } else if (p.armed) {
        collected[p.kind] = (collected[p.kind] ?? 0) + p.count;
        this.removeAt(i);
      }
    }
    return collected;
  }

  private removeAt(index: number): void {
    const last = this.pickups.length - 1;
    if (index !== last) this.pickups[index] = this.pickups[last]!;
    this.pickups.pop();
  }
}
