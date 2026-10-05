import { describe, expect, it } from 'vitest';
import { COMBAT_TUNING, applyDamage, circleHit, collisionDamage, createVitals, regenerateShield } from './combat';

describe('vitals', () => {
  it('shields absorb before hull and track the hit time', () => {
    const start = createVitals(20, 100);
    const first = applyDamage(start, 15, 10);
    expect(first.shieldAbsorbed).toBe(15);
    expect(first.hullDamage).toBe(0);
    expect(first.vitals.shield).toBe(5);
    expect(first.vitals.lastHitAt).toBe(10);
    const second = applyDamage(first.vitals, 15, 11);
    expect(second.shieldAbsorbed).toBe(5);
    expect(second.hullDamage).toBe(10);
    expect(second.vitals.hull).toBe(90);
    expect(second.destroyed).toBe(false);
  });

  it('reports destruction when the hull runs out', () => {
    const nearlyDead = { ...createVitals(0, 10), shield: 0 };
    const hit = applyDamage(nearlyDead, 25, 0);
    expect(hit.destroyed).toBe(true);
    expect(hit.vitals.hull).toBe(0);
    expect(applyDamage(hit.vitals, 5, 1).destroyed).toBe(true);
  });

  it('regenerates shields only after the quiet delay', () => {
    const hit = applyDamage(createVitals(60, 100), 30, 0).vitals;
    expect(regenerateShield(hit, 1, 1).shield).toBe(30);
    const later = regenerateShield(hit, 1, COMBAT_TUNING.shieldRegenDelay + 1);
    expect(later.shield).toBeCloseTo(30 + COMBAT_TUNING.shieldRegenRate, 5);
    const full = regenerateShield(hit, 100, 100);
    expect(full.shield).toBe(60);
  });

  it('circleHit and collisionDamage behave', () => {
    expect(circleHit(1, 1, 0, 0, 2)).toBe(true);
    expect(circleHit(3, 0, 0, 0, 2)).toBe(false);
    expect(collisionDamage(10)).toBe(0);
    expect(collisionDamage(COMBAT_TUNING.collisionMinSpeed + 20)).toBeCloseTo(20 * COMBAT_TUNING.collisionDamagePerSpeed, 5);
  });
});
