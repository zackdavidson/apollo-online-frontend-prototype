import { COMBAT_TUNING, createVitals, regenerateShield, type CombatTuning, type Vitals } from './combat';
import { wrapAngle, type FlightState } from './flightController';

/**
 * A stationary enemy that slowly tracks the player and returns fire when the
 * player is in range and roughly ahead. Pure state + step function.
 */
export interface EnemyState {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly vitals: Vitals;
  readonly alive: boolean;
  /** When a destroyed enemy comes back. */
  readonly respawnAt: number;
  readonly fireCooldown: number;
}

export function createEnemy(x: number, z: number, tuning: CombatTuning = COMBAT_TUNING): EnemyState {
  return { x, z, heading: Math.PI, vitals: createVitals(tuning.enemyShield, tuning.enemyHull), alive: true, respawnAt: 0, fireCooldown: 1 };
}

export interface EnemyStep {
  readonly enemy: EnemyState;
  /** True on the frame the enemy pulls the trigger. */
  readonly fire: boolean;
  /** True on the frame the enemy comes back to life. */
  readonly respawned: boolean;
}

export function stepEnemy(
  enemy: EnemyState,
  player: { readonly x: number; readonly z: number },
  dt: number,
  now: number,
  tuning: CombatTuning = COMBAT_TUNING,
): EnemyStep {
  if (!enemy.alive) {
    if (now < enemy.respawnAt) return { enemy, fire: false, respawned: false };
    return { enemy: { ...createEnemy(enemy.x, enemy.z, tuning), heading: enemy.heading }, fire: false, respawned: true };
  }

  const dx = player.x - enemy.x;
  const dz = player.z - enemy.z;
  const distance = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  const diff = wrapAngle(desired - enemy.heading);
  const step = Math.sign(diff) * Math.min(Math.abs(diff), tuning.enemyTurnRate * dt);
  const heading = wrapAngle(enemy.heading + step);

  let fireCooldown = Math.max(0, enemy.fireCooldown - dt);
  let fire = false;
  if (distance <= tuning.enemyRange && Math.abs(wrapAngle(desired - heading)) < 0.35 && fireCooldown === 0) {
    fire = true;
    fireCooldown = tuning.enemyFireInterval;
  }

  return {
    enemy: { ...enemy, heading, fireCooldown, vitals: regenerateShield(enemy.vitals, dt, now, tuning) },
    fire,
    respawned: false,
  };
}

export function killEnemy(enemy: EnemyState, now: number, tuning: CombatTuning = COMBAT_TUNING): EnemyState {
  return { ...enemy, alive: false, respawnAt: now + tuning.enemyRespawnDelay, vitals: { ...enemy.vitals, hull: 0, shield: 0 } };
}

/** The enemy as a FlightState so the shared projectile pool can fire from it. */
export function enemyAsFlightState(enemy: EnemyState): FlightState {
  return { x: enemy.x, z: enemy.z, vx: 0, vz: 0, heading: enemy.heading, throttle: 0 };
}
