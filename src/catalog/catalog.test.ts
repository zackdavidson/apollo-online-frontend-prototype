import { describe, expect, it } from 'vitest';
import { boundsContain, boundsOverlap, meshBounds } from '../core/mesh';
import { partMesh, slotTransform } from '../core/ship';
import { isCompatible } from '../core/types';
import { add, directionVector, scale } from '../core/vector';
import { ALL_ATTACHMENTS } from './attachments';
import { Catalog, createDefaultCatalog } from './catalog';
import { ALL_HULLS } from './hulls';

describe('default catalog', () => {
  const catalog = createDefaultCatalog();

  it('constructs without duplicate ids or bad defaults', () => {
    expect(catalog.hulls.length).toBeGreaterThanOrEqual(3);
    expect(catalog.attachments.length).toBeGreaterThan(10);
  });

  it('gives every slot at least one compatible attachment', () => {
    for (const hull of catalog.hulls) {
      for (const slot of hull.slots) {
        expect(catalog.compatibleAttachments(slot).length, `${hull.id}/${slot.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('exposes different attachment categories on different hulls', () => {
    const categoriesOf = (id: string): Set<string> => new Set(catalog.getHull(id).slots.flatMap((slot) => slot.accepts));
    const fighter = categoriesOf('hull-fighter');
    const miner = categoriesOf('hull-miner');
    expect(fighter.has('weapon')).toBe(true);
    expect(fighter.has('mining')).toBe(false);
    expect(miner.has('mining')).toBe(true);
    expect(miner.has('cargo')).toBe(true);
  });

  it('tessellates every part into a finite, non-empty mesh that extends along +Z', () => {
    for (const attachment of catalog.attachments) {
      const mesh = partMesh(attachment.primitives);
      expect(mesh.roles.length, attachment.id).toBeGreaterThan(3);
      for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
      const bounds = meshBounds(mesh);
      expect(bounds.max[2], `${attachment.id} should extend away from the mount`).toBeGreaterThan(0.1);
      expect(bounds.min[2], `${attachment.id} should start at the mount`).toBeGreaterThan(-0.3);
    }
    for (const hull of catalog.hulls) {
      const mesh = partMesh(hull.primitives);
      expect(mesh.roles.length, hull.id).toBeGreaterThan(50);
      for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('keeps every slot mount on the hull surface', () => {
    for (const hull of catalog.hulls) {
      const bounds = meshBounds(partMesh(hull.primitives));
      for (const slot of hull.slots) {
        // The mount itself sits on or just outside the hull; a short step inward lands inside its bounds.
        const inward = add(slot.position, scale(directionVector(slot.facing), -0.3));
        expect(boundsContain(bounds, slot.position, 0.1), `${hull.id}/${slot.id} mount floats away from the hull`).toBe(true);
        expect(boundsContain(bounds, inward), `${hull.id}/${slot.id} has nothing behind it`).toBe(true);
      }
    }
  });

  it('never lets default attachments overlap each other', () => {
    for (const hull of catalog.hulls) {
      const placed = hull.slots
        .filter((slot) => slot.defaultAttachment)
        .map((slot) => ({
          slot,
          bounds: meshBounds(partMesh(catalog.getAttachment(slot.defaultAttachment!).primitives, slotTransform(slot))),
        }));
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i]!;
          const b = placed[j]!;
          expect(boundsOverlap(a.bounds, b.bounds, 0.05), `${hull.id}: ${a.slot.id} overlaps ${b.slot.id}`).toBe(false);
        }
      }
    }
  });

  it('keeps every compatible attachment within its footprint class', () => {
    const limits = { small: 0.75, large: 1.5 };
    for (const attachment of catalog.attachments) {
      const bounds = meshBounds(partMesh(attachment.primitives));
      const reach = Math.max(-bounds.min[0], bounds.max[0], -bounds.min[1], bounds.max[1]);
      expect(reach, `${attachment.id} is too wide for a ${attachment.size} slot`).toBeLessThanOrEqual(limits[attachment.size]);
    }
  });
});

describe('Catalog validation', () => {
  it('rejects duplicate attachment ids', () => {
    const duplicate = [ALL_ATTACHMENTS[0]!, ALL_ATTACHMENTS[0]!];
    expect(() => new Catalog(ALL_HULLS, duplicate)).toThrow(/Duplicate attachment id/);
  });

  it('rejects incompatible default attachments', () => {
    const hull = ALL_HULLS[0]!;
    const slot = hull.slots[0]!;
    const wrong = ALL_ATTACHMENTS.find((a) => !isCompatible(slot, a))!;
    const broken = { ...hull, slots: [{ ...slot, defaultAttachment: wrong.id }] };
    expect(() => new Catalog([broken], ALL_ATTACHMENTS)).toThrow(/does not fit/);
  });
});
