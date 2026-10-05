import type { Vec3 } from '../core/vector';
import { forwardVector, type FlightState } from './flightController';
import type { Rng } from './random';
import { DEFAULT_WEAPON, type WeaponGroup, type WeaponProfile } from './weapons';

/** A weapon muzzle in ship space (hull slot position) and what it fires. */
export interface WeaponMount {
  readonly position: Vec3;
  readonly weapon: WeaponProfile;
}

export interface Projectile {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Seconds of life remaining. */
  life: number;
  readonly weapon: WeaponProfile;
}

/** Emitted once per shot so the view can draw a muzzle flash. */
export interface FireEvent {
  readonly mount: WeaponMount;
  readonly x: number;
  readonly z: number;
}

export interface PoolUpdate {
  readonly fired: readonly FireEvent[];
  /** Projectiles that ran out of life this frame (flak pops at the end of its flight). */
  readonly expired: readonly Projectile[];
}

export interface HomingTarget {
  readonly x: number;
  readonly z: number;
}

export const MAX_PROJECTILES = 512;
const HOMING_ACQUIRE_RANGE = 90;
/** Aim points closer than this to a muzzle are ignored; the mount fires straight ahead instead. */
const MIN_AIM_DISTANCE = 1.0;

export type AimPoint = readonly [number, number];

/**
 * Direction a mount at (x, z) should fire: towards the aim point when there
 * is one, otherwise straight along the heading. Mounts on opposite sides of
 * the ship therefore converge on the cursor.
 */
export function aimDirection(x: number, z: number, heading: number, aim: AimPoint | null): readonly [number, number] {
  if (aim) {
    const dx = aim[0] - x;
    const dz = aim[1] - z;
    const distance = Math.hypot(dx, dz);
    if (distance >= MIN_AIM_DISTANCE) return [dx / distance, dz / distance];
  }
  return forwardVector(heading);
}

/** Fallback muzzle when a ship has no weapons fitted. */
const DEFAULT_MOUNT: WeaponMount = { position: [0, 0, 1], weapon: DEFAULT_WEAPON };

/** Rotate a ship-space XZ offset by the heading and add the ship position. */
export function shipToWorld(state: FlightState, [px, , pz]: Vec3): readonly [number, number] {
  const c = Math.cos(state.heading);
  const s = Math.sin(state.heading);
  return [state.x + px * c + pz * s, state.z - px * s + pz * c];
}

/**
 * Velocity for a shot that must travel along unit direction (dx, dz) even
 * though it inherits the ship's velocity. The launch direction is skewed
 * against the ship's sideways motion so the sum lands on the aim line. If
 * the ship is sliding sideways faster than the shot can fly, it does its
 * best and the shot still drifts a little.
 */
export function launchVelocity(dx: number, dz: number, speed: number, shipVx: number, shipVz: number): readonly [number, number] {
  const along = shipVx * dx + shipVz * dz;
  const perpX = shipVx - along * dx;
  const perpZ = shipVz - along * dz;
  const perp = Math.hypot(perpX, perpZ);
  if (perp >= speed) {
    // Cannot cancel the drift entirely: fire straight into it as hard as possible.
    return [(-perpX / perp) * speed + shipVx, (-perpZ / perp) * speed + shipVz];
  }
  const forward = Math.sqrt(speed * speed - perp * perp);
  return [dx * forward - perpX + shipVx, dz * forward - perpZ + shipVz];
}

interface PendingBurst {
  readonly mount: WeaponMount;
  shotsLeft: number;
  delay: number;
}

/**
 * Pool of live projectiles for the projectile weapons (guns and missiles;
 * beams are handled by `beam.ts`). Every mount keeps its own cooldown. Gun
 * mounts are staggered so twin guns alternate; missile mounts fire together
 * as a volley. Supports shotgun spread, burst fire and homing. Pure logic.
 */
export class ProjectilePool {
  readonly projectiles: Projectile[] = [];
  private readonly mounts: readonly WeaponMount[];
  private readonly cooldowns: number[];
  private readonly bursts: PendingBurst[] = [];

  constructor(
    mounts: readonly WeaponMount[],
    private readonly rng: Rng = Math.random,
  ) {
    const projectileMounts = mounts.filter((mount) => mount.weapon.group !== 'beam');
    this.mounts = projectileMounts.length > 0 || mounts.length > 0 ? projectileMounts : [DEFAULT_MOUNT];
    const guns = this.mounts.filter((mount) => mount.weapon.group === 'guns');
    this.cooldowns = this.mounts.map((mount) => {
      if (mount.weapon.group !== 'guns') return 0;
      return (guns.indexOf(mount) / guns.length) * mount.weapon.fireInterval;
    });
  }

  /** Mounts that fire from this pool, for HUD counts. */
  countFor(group: WeaponGroup): number {
    return this.mounts.filter((mount) => mount.weapon.group === group).length;
  }

  /** 1 when every mount of the group is ready, falling towards 0 right after firing. */
  readiness(group: WeaponGroup): number {
    let worst = 1;
    this.mounts.forEach((mount, i) => {
      if (mount.weapon.group !== group) return;
      worst = Math.min(worst, 1 - this.cooldowns[i]! / mount.weapon.fireInterval);
    });
    return Math.max(0, worst);
  }

  /**
   * Advance cooldowns, bursts and projectiles. Mounts in the `firing` group
   * (or all mounts when `firing` is true / 'all') shoot as soon as ready.
   * Homing projectiles steer towards the nearest of `targets`.
   */
  update(
    dt: number,
    state: FlightState,
    firing: boolean | WeaponGroup | 'all',
    targets: readonly HomingTarget[] = [],
    aim: AimPoint | null = null,
  ): PoolUpdate {
    const fired: FireEvent[] = [];
    this.mounts.forEach((mount, i) => {
      this.cooldowns[i] = Math.max(0, this.cooldowns[i]! - dt);
      const wants = firing === true || firing === 'all' || firing === mount.weapon.group;
      if (!wants || this.cooldowns[i] !== 0) return;
      fired.push(...this.fireMount(state, mount, aim));
      this.cooldowns[i] = mount.weapon.fireInterval;
      if ((mount.weapon.burst ?? 1) > 1) {
        this.bursts.push({ mount, shotsLeft: mount.weapon.burst! - 1, delay: mount.weapon.burstGap ?? 0.1 });
      }
    });

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i]!;
      burst.delay -= dt;
      if (burst.delay > 0) continue;
      fired.push(...this.fireMount(state, burst.mount, aim));
      burst.shotsLeft -= 1;
      burst.delay = burst.mount.weapon.burstGap ?? 0.1;
      if (burst.shotsLeft <= 0) this.bursts.splice(i, 1);
    }

    const expired: Projectile[] = [];
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.weapon.homing) steer(p, targets, p.weapon.homing * dt);
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.life -= dt;
      if (p.life <= 0) {
        expired.push(p);
        this.removeAt(i);
      }
    }
    return { fired, expired };
  }

  /** Remove a projectile that hit something. */
  removeAt(index: number): void {
    const last = this.projectiles.length - 1;
    if (index < 0 || index > last) return;
    this.projectiles[index] = this.projectiles[last]!;
    this.projectiles.pop();
  }

  clear(): void {
    this.projectiles.length = 0;
    this.bursts.length = 0;
  }

  private fireMount(state: FlightState, mount: WeaponMount, aim: AimPoint | null): FireEvent[] {
    if (this.projectiles.length >= MAX_PROJECTILES) return [];
    const [x, z] = shipToWorld(state, mount.position);
    const [ax, az] = aimDirection(x, z, state.heading, aim);
    const baseAngle = Math.atan2(ax, az);
    const pellets = mount.weapon.pellets ?? 1;
    const spread = mount.weapon.spread ?? 0;
    for (let n = 0; n < pellets && this.projectiles.length < MAX_PROJECTILES; n++) {
      const offset = pellets > 1 ? (this.rng() - 0.5) * spread : 0;
      const [fx, fz] = forwardVector(baseAngle + offset);
      const speed = mount.weapon.speed * (pellets > 1 ? 0.85 + this.rng() * 0.3 : 1);
      const [vx, vz] = launchVelocity(fx, fz, speed, state.vx, state.vz);
      this.projectiles.push({ x, y: mount.position[1], z, vx, vz, life: mount.weapon.lifetime, weapon: mount.weapon });
    }
    return [{ mount, x, z }];
  }
}

/** Turn a projectile's velocity towards the nearest target within range, keeping its speed. */
function steer(p: Projectile, targets: readonly HomingTarget[], maxTurn: number): void {
  let best: HomingTarget | null = null;
  let bestDistance = HOMING_ACQUIRE_RANGE;
  for (const target of targets) {
    const distance = Math.hypot(target.x - p.x, target.z - p.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  if (!best) return;
  const speed = Math.hypot(p.vx, p.vz);
  if (speed < 1e-6) return;
  const current = Math.atan2(p.vx, p.vz);
  const desired = Math.atan2(best.x - p.x, best.z - p.z);
  const diff = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
  const turned = current + Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
  p.vx = Math.sin(turned) * speed;
  p.vz = Math.cos(turned) * speed;
}
