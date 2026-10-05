import { describe, expect, it } from 'vitest';
import { meshBounds } from './mesh';
import { box, cone, tube } from './primitives';
import { assembleShip, partMesh, slotTransform, sumStats } from './ship';
import { apply } from './transform';
import type { AttachmentDefinition, HullDefinition } from './types';

const hull: HullDefinition = {
  id: 'test-hull',
  name: 'Test',
  role: 'Test',
  description: '',
  stats: { mass: 10, thrust: 1 },
  primitives: [box({ size: [2, 1, 4], role: 'main' })],
  slots: [
    { id: 'rear', label: 'Rear', position: [0, 0, -2], facing: 'aft', accepts: ['thruster'], size: 'small' },
    { id: 'top', label: 'Top', position: [0, 0.5, 0], facing: 'up', accepts: ['utility'], size: 'small' },
  ],
};

const thruster: AttachmentDefinition = {
  id: 'test-thruster',
  name: 'Thruster',
  category: 'thruster',
  size: 'small',
  description: '',
  stats: { mass: 2, thrust: 5 },
  primitives: [tube({ radius: 0.4, z: [0, 1], role: 'dark' }), cone({ radius: 0.3, z: [1, 3], role: 'glow' })],
};

describe('assembleShip', () => {
  it('returns just the hull when nothing is fitted', () => {
    const ship = assembleShip(hull, []);
    expect(ship.mesh.roles).toHaveLength(16);
    expect(ship.stats).toEqual({ mass: 10, thrust: 1, firepower: 0, cargo: 0, mining: 0 });
    expect(ship.bounds.max[2]).toBeCloseTo(2);
  });

  it('places aft-facing attachments behind the mount', () => {
    const rear = hull.slots[0]!;
    const ship = assembleShip(hull, [{ slot: rear, attachment: thruster }]);
    expect(ship.bounds.min[2]).toBeCloseTo(-5, 5);
    expect(ship.stats.thrust).toBe(6);
    expect(ship.stats.mass).toBe(12);
    expect(ship.mesh.roles.filter((r) => r === 'glow').length).toBeGreaterThan(0);
  });

  it('rotates upward-facing attachments so +Z becomes +Y', () => {
    const top = hull.slots[1]!;
    const bounds = meshBounds(partMesh(thruster.primitives, slotTransform(top)));
    expect(bounds.max[1]).toBeCloseTo(3.5, 5);
    expect(bounds.min[1]).toBeCloseTo(0.5, 5);
  });

  it('slotTransform maps the attachment origin onto the slot position', () => {
    for (const slot of hull.slots) {
      expect(apply(slotTransform(slot), [0, 0, 0])).toEqual(slot.position);
    }
  });
});

describe('sumStats', () => {
  it('adds partial stat blocks with missing keys treated as zero', () => {
    expect(sumStats([{ thrust: 2 }, { thrust: 3, cargo: 4 }, {}])).toEqual({
      mass: 0,
      thrust: 5,
      firepower: 0,
      cargo: 4,
      mining: 0,
    });
  });
});
