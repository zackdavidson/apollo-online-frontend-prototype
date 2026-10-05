import { describe, expect, it } from 'vitest';
import { LootField, emptyInventory, inventoryValue } from './loot';
import { createRng } from './random';

describe('LootField', () => {
  it('spawns pickups that drift apart and expire', () => {
    const field = new LootField(createRng(1), { lifetime: 2, magnetRange: 10, magnetAccel: 50, maxPullSpeed: 40, drag: 1, maxPickups: 100 });
    field.spawn(0, 0, 'ore', 5);
    expect(field.pickups).toHaveLength(5);
    field.step(0.5, null);
    expect(field.pickups.every((p) => Math.hypot(p.x, p.z) > 0.5)).toBe(true);
    field.step(3, null);
    expect(field.pickups).toHaveLength(0);
  });

  it('pulls nearby pickups in and collects them on contact', () => {
    const field = new LootField(createRng(2));
    field.spawn(8, 0, 'crystal', 3);
    let collected = emptyInventory();
    for (let t = 0; t < 3; t += 1 / 60) {
      const got = field.step(1 / 60, { x: 0, z: 0, radius: 2 });
      for (const [kind, count] of Object.entries(got)) collected[kind as keyof typeof collected] += count ?? 0;
    }
    expect(collected.crystal).toBe(3);
    expect(field.pickups).toHaveLength(0);
  });

  it('leaves far pickups alone', () => {
    const field = new LootField(createRng(3));
    field.spawn(200, 0, 'iron', 2);
    for (let t = 0; t < 2; t += 1 / 60) field.step(1 / 60, { x: 0, z: 0, radius: 2 });
    expect(field.pickups).toHaveLength(2);
    expect(field.pickups.every((p) => p.x > 150)).toBe(true);
  });

  it('values an inventory', () => {
    expect(inventoryValue({ ore: 2, iron: 1, ice: 0, crystal: 1 })).toBe(2 + 3 + 10);
  });
});
