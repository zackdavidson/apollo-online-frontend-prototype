import { describe, expect, it } from 'vitest';
import { createDefaultCatalog } from '../catalog/catalog';
import { decodeShipState, encodeShipState } from './serialization';
import { createShipState, withAttachment, withHull, withRandomLoadout } from './shipState';

const catalog = createDefaultCatalog();
const fighter = catalog.getHull('hull-fighter');
const miner = catalog.getHull('hull-miner');

describe('ship state reducers', () => {
  it('starts with the hull default loadout', () => {
    const state = createShipState(fighter);
    expect(state.fitted['nose']).toBe('weapon-autocannon');
    expect(state.fitted['dorsal']).toBeUndefined();
  });

  it('resets the loadout when switching hull but keeps colours', () => {
    const state = withHull(createShipState(fighter, { main: '#112233', trim: '#445566' }), miner);
    expect(state.hullId).toBe(miner.id);
    expect(state.colours).toEqual({ main: '#112233', trim: '#445566' });
    expect(state.fitted['tool']).toBe('mining-drill');
    expect(state.fitted['nose']).toBeUndefined();
  });

  it('fits compatible attachments and ignores incompatible ones', () => {
    const base = createShipState(fighter);
    const fitted = withAttachment(base, catalog, 'nose', 'weapon-missile-pod');
    expect(fitted.fitted['nose']).toBe('weapon-missile-pod');
    expect(withAttachment(base, catalog, 'nose', 'mining-drill')).toBe(base);
    expect(withAttachment(base, catalog, 'no-such-slot', 'weapon-laser')).toBe(base);
  });

  it('empties a slot with null', () => {
    const state = withAttachment(createShipState(fighter), catalog, 'nose', null);
    expect(state.fitted['nose']).toBeUndefined();
  });

  it('randomises into a valid loadout', () => {
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };
    const state = withRandomLoadout(createShipState(miner), catalog, random);
    for (const slot of miner.slots) {
      const id = state.fitted[slot.id];
      if (id === undefined) continue;
      expect(catalog.compatibleAttachments(slot).map((a) => a.id)).toContain(id);
    }
  });
});

describe('serialization', () => {
  it('round-trips a build', () => {
    const state = withAttachment(createShipState(miner, { main: '#a8322e', trim: '#f2e6c9' }), catalog, 'roof', 'utility-radar');
    const code = encodeShipState(state);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShipState(code, catalog)).toEqual(state);
  });

  it('drops unknown or incompatible attachments but keeps the rest', () => {
    const payload = {
      v: 1,
      hull: 'hull-fighter',
      main: '#000000',
      trim: '#ffffff',
      fit: { nose: 'weapon-laser', 'wing-port': 'mining-drill', bogus: 'weapon-laser' },
    };
    const code = btoa(JSON.stringify(payload));
    expect(decodeShipState(code, catalog)?.fitted).toEqual({ nose: 'weapon-laser' });
  });

  it('returns null for garbage, wrong versions and unknown hulls', () => {
    expect(decodeShipState('not base64!', catalog)).toBeNull();
    expect(decodeShipState(btoa(JSON.stringify({ v: 2, hull: 'hull-fighter' })), catalog)).toBeNull();
    expect(decodeShipState(btoa(JSON.stringify({ v: 1, hull: 'nope', main: '#000000', trim: '#ffffff' })), catalog)).toBeNull();
    expect(decodeShipState('', catalog)).toBeNull();
  });
});
