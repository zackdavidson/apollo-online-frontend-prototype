import type { FlightState } from './flightController';
import type { ResourceKind } from './loot';
import { range, type Rng } from './random';

/**
 * A shooting star: one big icy body with a long tail, crossing the map
 * slowly on a straight line. It has a deep health pool, sheds resource
 * chunks as it is mined, bursts with a payload when depleted, and a new one
 * enters from another edge after a delay. Pure logic.
 */

export interface CometTuning {
  readonly maxHp: number;
  readonly radius: number;
  /** Units per second; well under the ship's top speed so it can be chased down. */
  readonly speed: number;
  /** Distance from the start the first comet spawns at, so it is on the radar right away. */
  readonly startDistance: number;
  /** How far past the map edge it may fly before it counts as gone. */
  readonly exitMargin: number;
  readonly respawnDelay: number;
  /** Damage dealt per chunk shed while mining. */
  readonly chunkEvery: number;
  readonly chunkCrystalChance: number;
  readonly finalDrops: Readonly<Partial<Record<ResourceKind, number>>>;
}

export const COMET_TUNING: CometTuning = {
  maxHp: 2400,
  radius: 6,
  speed: 14,
  startDistance: 900,
  exitMargin: 300,
  respawnDelay: 25,
  chunkEvery: 120,
  chunkCrystalChance: 0.35,
  finalDrops: { ice: 40, crystal: 14, 'iron-ore': 8 },
};

export const COMET_RESOURCES: readonly ResourceKind[] = ['ice', 'crystal', 'iron-ore'];

export interface CometState {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly radius: number;
  readonly alive: boolean;
  /** When the next comet enters, once this one is gone. */
  readonly respawnAt: number;
  /** Damage dealt since the last chunk was shed. */
  readonly minedSinceChunk: number;
}

/**
 * Spawn a comet. The first one starts `startDistance` from the origin and
 * aims to pass near the start; later ones enter from a random edge heading
 * for a random point near the middle, so they always cross the playable area.
 */
export function spawnComet(rng: Rng, halfExtent: number, nearStart: boolean, tuning: CometTuning = COMET_TUNING): CometState {
  const angle = rng() * Math.PI * 2;
  const distance = nearStart ? tuning.startDistance : halfExtent * 1.04;
  const x = Math.cos(angle) * distance;
  const z = Math.sin(angle) * distance;
  // Aim through a point on the far side of the centre, offset so the path is not dead straight through the origin.
  const spread = nearStart ? 350 : 1500;
  const targetX = -Math.cos(angle) * distance * 0.6 + range(rng, -spread, spread);
  const targetZ = -Math.sin(angle) * distance * 0.6 + range(rng, -spread, spread);
  const dx = targetX - x;
  const dz = targetZ - z;
  const length = Math.hypot(dx, dz) || 1;
  return {
    x,
    z,
    vx: (dx / length) * tuning.speed,
    vz: (dz / length) * tuning.speed,
    hp: tuning.maxHp,
    maxHp: tuning.maxHp,
    radius: tuning.radius,
    alive: true,
    respawnAt: 0,
    minedSinceChunk: 0,
  };
}

export interface CometStep {
  readonly comet: CometState;
  /** True on the frame a new comet enters the map. */
  readonly entered: boolean;
  /** True on the frame the comet flies off the map unmined. */
  readonly left: boolean;
}

export function stepComet(comet: CometState, dt: number, now: number, halfExtent: number, rng: Rng, tuning: CometTuning = COMET_TUNING): CometStep {
  if (!comet.alive) {
    if (now < comet.respawnAt) return { comet, entered: false, left: false };
    return { comet: spawnComet(rng, halfExtent, false, tuning), entered: true, left: false };
  }
  const x = comet.x + comet.vx * dt;
  const z = comet.z + comet.vz * dt;
  const limit = halfExtent + tuning.exitMargin;
  if (Math.abs(x) > limit || Math.abs(z) > limit) {
    return { comet: { ...comet, x, z, alive: false, respawnAt: now + tuning.respawnDelay }, entered: false, left: true };
  }
  return { comet: { ...comet, x, z }, entered: false, left: false };
}

export interface CometDamage {
  readonly comet: CometState;
  readonly destroyed: boolean;
  /** Chunks shed by this hit (0 when no threshold was crossed). */
  readonly chunks: number;
}

export function damageComet(comet: CometState, amount: number, now: number, tuning: CometTuning = COMET_TUNING): CometDamage {
  if (!comet.alive || amount <= 0) return { comet, destroyed: false, chunks: 0 };
  const hp = Math.max(0, comet.hp - amount);
  const mined = comet.minedSinceChunk + Math.min(amount, comet.hp);
  const chunks = Math.floor(mined / tuning.chunkEvery);
  if (hp <= 0) {
    return { comet: { ...comet, hp: 0, alive: false, respawnAt: now + tuning.respawnDelay, minedSinceChunk: 0 }, destroyed: true, chunks };
  }
  return { comet: { ...comet, hp, minedSinceChunk: mined - chunks * tuning.chunkEvery }, destroyed: false, chunks };
}

/** Resource of one shed chunk. */
export function chunkResource(rng: Rng, tuning: CometTuning = COMET_TUNING): ResourceKind {
  return rng() < tuning.chunkCrystalChance ? 'crystal' : 'ice';
}

const SCRAPE_FRICTION = 0.6;

/**
 * Push the ship out of the comet and stop it relative to the comet, so a
 * ship that flies into it is carried along rather than bounced off.
 */
export function cometCollideShip(state: FlightState, comet: CometState, shipRadius: number): { state: FlightState; impactSpeed: number } {
  if (!comet.alive) return { state, impactSpeed: 0 };
  const dx = state.x - comet.x;
  const dz = state.z - comet.z;
  const distance = Math.hypot(dx, dz) || 1e-6;
  const penetration = comet.radius + shipRadius - distance;
  if (penetration <= 0) return { state, impactSpeed: 0 };
  const nx = dx / distance;
  const nz = dz / distance;
  let relX = state.vx - comet.vx;
  let relZ = state.vz - comet.vz;
  const approach = relX * nx + relZ * nz;
  let impactSpeed = 0;
  if (approach < 0) {
    impactSpeed = -approach;
    relX -= approach * nx;
    relZ -= approach * nz;
    relX *= SCRAPE_FRICTION;
    relZ *= SCRAPE_FRICTION;
  }
  return {
    state: { ...state, x: state.x + nx * penetration, z: state.z + nz * penetration, vx: comet.vx + relX, vz: comet.vz + relZ },
    impactSpeed,
  };
}
