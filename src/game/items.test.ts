import { describe, expect, it } from 'vitest';
import { createDefaultCatalog } from '../catalog/catalog';
import { DEFAULT_ITEMS, ItemParseError, RESOURCE_KINDS, defaultItemCatalog, parseItemCatalog } from './items';
import { WEAPON_PROFILES, weaponProfileFor } from './weapons';

describe('item catalog', () => {
  it('round-trips through JSON and keeps every resource and weapon', () => {
    const parsed = parseItemCatalog(JSON.parse(JSON.stringify(DEFAULT_ITEMS)));
    expect(parsed.items).toEqual(DEFAULT_ITEMS);
    for (const kind of RESOURCE_KINDS) expect(parsed.require(kind).category).toBe('resource');
    expect(parsed.weapons.length).toBeGreaterThanOrEqual(13);
  });

  it('points every fitted weapon at a real part in the ship catalog, with a matching profile for the simulation', () => {
    const parts = createDefaultCatalog();
    for (const item of defaultItemCatalog().weapons) {
      const model = item.visual.model;
      expect(model.kind).toBe('attachment');
      if (model.kind === 'attachment') expect(parts.getAttachment(model.attachmentId).id).toBe(model.attachmentId);
      expect(item.visual.effect).toBeDefined();
      const profile = WEAPON_PROFILES[item.id];
      expect(profile).toBeDefined();
      expect(profile).toMatchObject({ id: item.id, ...item.behaviour, ...item.visual.effect });
    }
    // Every weapon part in the ship catalog has an item, so fitting it means something.
    for (const part of parts.attachments.filter((a) => a.category === 'weapon' || a.id.startsWith('mining-laser') || a.id.startsWith('mining-drill'))) {
      expect(weaponProfileFor(part.id).id).toBe(part.id);
    }
  });

  it('separates looks from behaviour: a client view has models and effects but no stats', () => {
    const client = defaultItemCatalog().clientView();
    expect(client.require('weapon-autocannon').behaviour).toBeUndefined();
    expect(client.require('weapon-autocannon').visual.effect?.colour).toBe('#ffd36a');
    expect(client.require('stone').visual.model.kind).toBe('primitives');
    expect(client.weapons).toHaveLength(0);
  });

  it('rejects malformed catalogs with a path', () => {
    expect(() => parseItemCatalog({})).toThrow(ItemParseError);
    expect(() => parseItemCatalog([{ id: 'x' }])).toThrow(/items\[0\]\.visual/);
    expect(() => parseItemCatalog([{ id: 'x', name: 'X', category: 'relic', visual: { model: { kind: 'attachment', attachmentId: 'a' }, colour: '#fff' } }])).toThrow(/category/);
    expect(() => parseItemCatalog([{ id: 'x', name: 'X', category: 'weapon', visual: { model: { kind: 'attachment', attachmentId: 'a' }, colour: '#fff' }, behaviour: { kind: 'tracer', group: 'guns', speed: 1, lifetime: 1, damage: 1, fireInterval: 1 } }])).toThrow(/effect/);
    // A catalog without the resources rocks drop is unusable.
    expect(() => parseItemCatalog(DEFAULT_ITEMS.filter((item) => item.id !== 'ice'))).toThrow(/missing resource item "ice"/);
    expect(() => parseItemCatalog([...DEFAULT_ITEMS, DEFAULT_ITEMS[0]!])).toThrow(/Duplicate item id/);
  });
});
