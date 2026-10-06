import { describe, expect, it } from 'vitest';
import { EntityType, EXAMINE_OPTION, HUD_INTERFACE_IDS } from '../client/definitions';
import { optionsFor } from './actions';

describe('optionsFor', () => {
  it('numbers options from the definitions and sends the option picked', () => {
    const ground = optionsFor({ kind: 'obj', item: { id: 7, kind: 'iron-ore', count: 2 } });
    expect(ground.map((o) => o.label)).toEqual(['Take', 'Examine']);
    expect(ground[0]).toMatchObject({ target: 'Iron ore × 2', message: { type: 'op-obj', option: 1, index: 7 } });
    expect(ground[1]!.message).toEqual({ type: 'op-obj', option: EXAMINE_OPTION, index: 7 });

    const rock = optionsFor({ kind: 'rock', rock: { id: 'rock-0001', kind: 'crystal' } });
    expect(rock.map((o) => o.label)).toEqual(['Mine', 'Examine']);
    expect(rock[0]!.message).toEqual({ type: 'op-loc', option: 1, locId: 'rock-0001' });
    expect(rock[0]!.target).toBe('Crystal rock');

    expect(optionsFor({ kind: 'npc', index: 3, entityType: EntityType.COMET, name: 'Comet', inTalkRange: false })[0]!.message).toEqual({ type: 'op-npc', option: 1, index: 3 });
  });

  it('changes with where the item is: hold versus fitted', () => {
    const held = optionsFor({ kind: 'held', item: 'ice', count: 4, slot: 2 });
    expect(held.map((o) => o.label)).toEqual(['Examine', 'Drop']);
    expect(held[1]!.message).toEqual({ type: 'op-held', option: 1, item: 'ice', slot: 2 });

    const fitted = optionsFor({ kind: 'equipped', itemId: 'mining-laser', group: 'beam' });
    expect(fitted.map((o) => o.label)).toEqual(['Select', 'Examine']);
    expect(fitted[0]).toMatchObject({ target: 'Beam (Mining Laser)', message: { type: 'if-button', interfaceId: HUD_INTERFACE_IDS.weapons, button: 2 } });
  });

  it('offers Talk-to only within range, and nothing but Examine for players', () => {
    const near = optionsFor({ kind: 'npc', index: 9, entityType: EntityType.SHIP, name: 'Navigator', inTalkRange: true });
    expect(near.map((o) => o.label)).toEqual(['Talk-to', 'Examine']);
    const far = optionsFor({ kind: 'npc', index: 9, entityType: EntityType.SHIP, name: 'Navigator', inTalkRange: false });
    expect(far.map((o) => o.label)).toEqual(['Examine']);
    expect(optionsFor({ kind: 'player', index: 1, name: 'Pilot', isSelf: true }).map((o) => o.label)).toEqual(['Examine']);
    expect(optionsFor({ kind: 'beacon', beacon: { id: 'b', label: 'East gate' } }).map((o) => o.label)).toEqual(['Examine']);
  });
});
