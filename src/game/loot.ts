import { range, type Rng } from './random';

/**
 * Resources dropped by rocks and the pickups that carry them. Pickups drift,
 * get pulled in when the ship is close, and are collected on contact.
 */

export type ResourceKind = 'ore' | 'iron' | 'ice' | 'crystal';

export const RESOURCE_KINDS: readonly ResourceKind[] = ['ore', 'iron', 'ice', 'crystal'];

export interface ResourceInfo {
  readonly label: string;
  readonly colour: string;
  /** Rough worth, for a score line. */
  readonly value: number;
}

export const RESOURCES: Readonly<Record<ResourceKind, ResourceInfo>> = {
  ore: { label: 'Ore', colour: '#d9b26a', value: 1 },
  iron: { label: 'Iron', colour: '#9fb4c8', value: 3 },
  ice: { label: 'Ice', colour: '#8fe3ff', value: 2 },
  crystal: { label: 'Crystal', colour: '#d9a6ff', value: 10 },
};

export type Inventory = Record<ResourceKind, number>;

export function emptyInventory(): Inventory {
  return { ore: 0, iron: 0, ice: 0, crystal: 0 };
}

export function inventoryValue(inventory: Inventory): number {
  return RESOURCE_KINDS.reduce((total, kind) => total + inventory[kind] * RESOURCES[kind].value, 0);
}

export interface Pickup {
  readonly id: number;
  readonly kind: ResourceKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Seconds left before it fades away. */
  life: number;
  readonly phase: number;
}

export interface LootTuning {
  readonly lifetime: number;
  /** Distance within which pickups are pulled towards the ship. */
  readonly magnetRange: number;
  readonly magnetAccel: number;
  readonly maxPullSpeed: number;
  readonly drag: number;
  readonly maxPickups: number;
}

export const DEFAULT_LOOT_TUNING: LootTuning = { lifetime: 45, magnetRange: 16, magnetAccel: 90, maxPullSpeed: 55, drag: 1.2, maxPickups: 400 };

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

  /** Scatter `count` pickups of `kind` around a point. Pass `Infinity` as lifetime for permanent caches. */
  spawn(x: number, z: number, kind: ResourceKind, count: number, lifetime: number = this.tuning.lifetime): void {
    for (let i = 0; i < count && this.pickups.length < this.tuning.maxPickups; i++) {
      const angle = this.rng() * Math.PI * 2;
      const speed = range(this.rng, 2, 7);
      this.pickups.push({
        id: this.nextId++,
        kind,
        x: x + Math.cos(angle) * 0.6,
        z: z + Math.sin(angle) * 0.6,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        life: lifetime * range(this.rng, 0.85, 1.0),
        phase: this.rng() * Math.PI * 2,
      });
    }
  }

  /** Move pickups, pull nearby ones in, and return what the collector picked up. */
  step(dt: number, collector: Collector | null): Partial<Record<ResourceKind, number>> {
    const collected: Partial<Record<ResourceKind, number>> = {};
    const damping = Math.exp(-this.tuning.drag * dt);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.removeAt(i);
        continue;
      }
      if (collector) {
        const dx = collector.x - p.x;
        const dz = collector.z - p.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= collector.radius + 0.9) {
          collected[p.kind] = (collected[p.kind] ?? 0) + 1;
          this.removeAt(i);
          continue;
        }
        if (distance < this.tuning.magnetRange) {
          const pull = this.tuning.magnetAccel * (1 - distance / this.tuning.magnetRange + 0.3);
          p.vx += (dx / distance) * pull * dt;
          p.vz += (dz / distance) * pull * dt;
          const speed = Math.hypot(p.vx, p.vz);
          if (speed > this.tuning.maxPullSpeed) {
            p.vx *= this.tuning.maxPullSpeed / speed;
            p.vz *= this.tuning.maxPullSpeed / speed;
          }
        } else {
          p.vx *= damping;
          p.vz *= damping;
        }
      } else {
        p.vx *= damping;
        p.vz *= damping;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
    }
    return collected;
  }

  private removeAt(index: number): void {
    const last = this.pickups.length - 1;
    this.pickups[index] = this.pickups[last]!;
    this.pickups.pop();
  }
}
