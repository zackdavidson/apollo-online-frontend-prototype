/**
 * Shields, hull points and damage. Pure functions shared by the player and
 * enemies. Shields absorb damage first and regenerate after a quiet spell.
 */

export interface Vitals {
  readonly shield: number;
  readonly maxShield: number;
  readonly hull: number;
  readonly maxHull: number;
  /** Time of the last hit, used to delay shield regeneration. */
  readonly lastHitAt: number;
}

export interface CombatTuning {
  readonly playerShield: number;
  readonly playerHull: number;
  readonly enemyShield: number;
  readonly enemyHull: number;
  readonly shieldRegenDelay: number;
  /** Shield points regained per second once regeneration starts. */
  readonly shieldRegenRate: number;
  /** Rock impacts slower than this are free; faster ones hurt. */
  readonly collisionMinSpeed: number;
  readonly collisionDamagePerSpeed: number;
  readonly enemyRange: number;
  readonly enemyFireInterval: number;
  readonly enemyTurnRate: number;
  readonly enemyRespawnDelay: number;
  readonly playerRespawnDelay: number;
}

export const COMBAT_TUNING: CombatTuning = {
  playerShield: 60,
  playerHull: 100,
  enemyShield: 80,
  enemyHull: 120,
  shieldRegenDelay: 3,
  shieldRegenRate: 12,
  collisionMinSpeed: 18,
  collisionDamagePerSpeed: 0.5,
  enemyRange: 240,
  enemyFireInterval: 1.3,
  enemyTurnRate: 1.2,
  enemyRespawnDelay: 8,
  playerRespawnDelay: 2.5,
};

export function createVitals(maxShield: number, maxHull: number): Vitals {
  return { shield: maxShield, maxShield, hull: maxHull, maxHull, lastHitAt: -Infinity };
}

export interface DamageResult {
  readonly vitals: Vitals;
  readonly shieldAbsorbed: number;
  readonly hullDamage: number;
  readonly destroyed: boolean;
}

/** Shields soak up damage first; whatever is left comes off the hull. */
export function applyDamage(vitals: Vitals, amount: number, now: number): DamageResult {
  if (amount <= 0 || vitals.hull <= 0) return { vitals, shieldAbsorbed: 0, hullDamage: 0, destroyed: vitals.hull <= 0 };
  const shieldAbsorbed = Math.min(vitals.shield, amount);
  const hullDamage = Math.min(vitals.hull, amount - shieldAbsorbed);
  const hull = vitals.hull - hullDamage;
  return {
    vitals: { ...vitals, shield: vitals.shield - shieldAbsorbed, hull, lastHitAt: now },
    shieldAbsorbed,
    hullDamage,
    destroyed: hull <= 0,
  };
}

export function regenerateShield(vitals: Vitals, dt: number, now: number, tuning: CombatTuning = COMBAT_TUNING): Vitals {
  if (vitals.hull <= 0 || vitals.shield >= vitals.maxShield) return vitals;
  if (now - vitals.lastHitAt < tuning.shieldRegenDelay) return vitals;
  return { ...vitals, shield: Math.min(vitals.maxShield, vitals.shield + tuning.shieldRegenRate * dt) };
}

export function circleHit(px: number, pz: number, cx: number, cz: number, radius: number): boolean {
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz <= radius * radius;
}

/** Damage from ramming a rock at `impactSpeed`. */
export function collisionDamage(impactSpeed: number, tuning: CombatTuning = COMBAT_TUNING): number {
  return Math.max(0, impactSpeed - tuning.collisionMinSpeed) * tuning.collisionDamagePerSpeed;
}
