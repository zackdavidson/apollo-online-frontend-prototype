import { describe, expect, it } from 'vitest';
import { LootField, RESOURCES, emptyInventory, inventoryValue } from './loot';
import { createRng } from './random';

describe('LootField', () => {
  it('drops one stack that stays where it fell and fades out', () => {
    const field = new LootField(createRng(1));
    const stack = field.spawn(0, 0, 'stone', 5)!;
    expect(field.pickups).toHaveLength(1);
    expect(stack.count).toBe(5);
    expect(Math.hypot(stack.x, stack.z)).toBeLessThan(2);
    const { x, z } = stack;
    for (let t = 0; t < 10; t += 1 / 60) field.step(1 / 60, null);
    expect(field.pickups[0]).toMatchObject({ x, z });
    for (let t = 0; t < 50; t += 1 / 60) field.step(1 / 60, null);
    expect(field.pickups).toHaveLength(0);
  });

  it('collects the whole stack when the collector is within reach, and leaves far ones alone', () => {
    const field = new LootField(createRng(2));
    const near = field.spawn(0, 0, 'crystal', 3)!;
    field.spawn(200, 0, 'iron-ore', 2);
    const collected = emptyInventory();
    for (let t = 0; t < 1; t += 1 / 60) {
      const got = field.step(1 / 60, { x: near.x, z: near.z, radius: 2 });
      for (const [kind, count] of Object.entries(got)) collected[kind as keyof typeof collected] += count ?? 0;
    }
    expect(collected.crystal).toBe(3);
    expect(field.pickups.map((p) => p.kind)).toEqual(['iron-ore']);
  });

  it('does not re-collect a stack the player just dropped until they have moved away, but Take always works', () => {
    const field = new LootField(createRng(3));
    const dropped = field.spawn(0, 0, 'ice', 4, 45, { armed: false })!;
    const onTop = { x: dropped.x, z: dropped.z, radius: 2 };
    for (let t = 0; t < 1; t += 1 / 60) expect(field.step(1 / 60, onTop)).toEqual({});
    expect(field.pickups).toHaveLength(1);
    field.step(1 / 60, { x: 50, z: 0, radius: 2 }); // walk away: arms it
    expect(field.step(1 / 60, onTop)).toEqual({ ice: 4 });
    const again = field.spawn(0, 0, 'ice', 1, 45, { armed: false })!;
    expect(field.take(again.id, { x: 30, z: 0, radius: 2 }, 10)).toBeNull();
    expect(field.take(again.id, { x: 5, z: 0, radius: 2 }, 10)).toBe(again);
    expect(field.pickups).toHaveLength(0);
    expect(field.at(0, 0)).toBeNull();
  });

  it('values cargo from the item catalog', () => {
    const cargo = { ...emptyInventory(), stone: 3, crystal: 1 };
    expect(inventoryValue(cargo)).toBe(3 * RESOURCES.stone.value + RESOURCES.crystal.value);
    expect(RESOURCES['iron-ore'].label).toBe('Iron ore');
  });
});
