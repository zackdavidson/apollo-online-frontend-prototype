import type { Rng } from './random';

/**
 * Per-hit damage variation. A weapon's listed damage is its full hit; most
 * hits land a little under it, some glance for much less, and some crit for
 * roughly double. Pure and seeded so it is reproducible.
 */

export type HitKind = 'normal' | 'glancing' | 'critical';

export interface DamageRollTuning {
  /** Normal hits land between this fraction and 1.0 of the listed damage. */
  readonly minFactor: number;
  readonly glanceChance: number;
  readonly glanceMin: number;
  readonly glanceMax: number;
  readonly critChance: number;
  readonly critMin: number;
  readonly critMax: number;
}

export const DAMAGE_ROLL: DamageRollTuning = {
  minFactor: 0.88,
  glanceChance: 0.1,
  glanceMin: 0.6,
  glanceMax: 0.78,
  critChance: 0.12,
  critMin: 1.75,
  critMax: 2.2,
};

export interface DamageRoll {
  readonly amount: number;
  readonly kind: HitKind;
}

export function rollDamage(base: number, rng: Rng, tuning: DamageRollTuning = DAMAGE_ROLL): DamageRoll {
  if (base <= 0) return { amount: 0, kind: 'normal' };
  const roll = rng();
  if (roll < tuning.critChance) {
    return { amount: base * (tuning.critMin + (tuning.critMax - tuning.critMin) * rng()), kind: 'critical' };
  }
  if (roll < tuning.critChance + tuning.glanceChance) {
    return { amount: base * (tuning.glanceMin + (tuning.glanceMax - tuning.glanceMin) * rng()), kind: 'glancing' };
  }
  return { amount: base * (tuning.minFactor + (1 - tuning.minFactor) * rng()), kind: 'normal' };
}

/** Whole-number label for a hit marker; never shows 0 for a hit that landed. */
export function formatHit(amount: number): string {
  return String(Math.max(1, Math.round(amount)));
}
