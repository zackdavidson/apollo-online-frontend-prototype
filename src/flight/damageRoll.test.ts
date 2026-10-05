import { describe, expect, it } from 'vitest';
import { DAMAGE_ROLL, formatHit, rollDamage } from './damageRoll';
import { createRng } from './random';

describe('rollDamage', () => {
  it('keeps every kind inside its band and hits the tuned frequencies', () => {
    const rng = createRng(11);
    const counts = { normal: 0, glancing: 0, critical: 0 };
    const samples = 20000;
    for (let i = 0; i < samples; i++) {
      const { amount, kind } = rollDamage(10, rng);
      counts[kind]++;
      if (kind === 'normal') {
        expect(amount).toBeGreaterThanOrEqual(10 * DAMAGE_ROLL.minFactor);
        expect(amount).toBeLessThanOrEqual(10);
      } else if (kind === 'glancing') {
        expect(amount).toBeGreaterThanOrEqual(10 * DAMAGE_ROLL.glanceMin);
        expect(amount).toBeLessThanOrEqual(10 * DAMAGE_ROLL.glanceMax);
      } else {
        expect(amount).toBeGreaterThanOrEqual(10 * DAMAGE_ROLL.critMin);
        expect(amount).toBeLessThanOrEqual(10 * DAMAGE_ROLL.critMax);
      }
    }
    expect(counts.critical / samples).toBeCloseTo(DAMAGE_ROLL.critChance, 1);
    expect(counts.glancing / samples).toBeCloseTo(DAMAGE_ROLL.glanceChance, 1);
    expect(counts.normal / samples).toBeGreaterThan(0.7);
  });

  it('is not wildly random: most hits are within 12% of the listed damage', () => {
    const rng = createRng(12);
    let close = 0;
    for (let i = 0; i < 5000; i++) {
      const { amount } = rollDamage(100, rng);
      if (amount >= 88 && amount <= 100) close++;
    }
    expect(close / 5000).toBeGreaterThan(0.7);
  });

  it('scales with the base and handles zero', () => {
    const a = rollDamage(10, createRng(5));
    const b = rollDamage(20, createRng(5));
    expect(b.amount).toBeCloseTo(a.amount * 2, 6);
    expect(b.kind).toBe(a.kind);
    expect(rollDamage(0, createRng(5))).toEqual({ amount: 0, kind: 'normal' });
  });

  it('formats hit labels as whole numbers of at least 1', () => {
    expect(formatHit(0.3)).toBe('1');
    expect(formatHit(17.6)).toBe('18');
  });
});
