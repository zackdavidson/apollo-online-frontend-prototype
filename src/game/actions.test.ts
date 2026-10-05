import { describe, expect, it } from 'vitest';
import { optionsFor } from './actions';
import { rockFromSpec } from './rocks';

describe('optionsFor', () => {
  it('puts the default first and names the target', () => {
    const ground = optionsFor({ kind: 'ground', pickup: { id: 7, kind: 'iron-ore', count: 2, x: 0, z: 0, life: 10, phase: 0, armed: true } });
    expect(ground.map((o) => o.label)).toEqual(['Take', 'Examine']);
    expect(ground[0]).toMatchObject({ target: 'Iron ore × 2', action: { type: 'take', pickupId: 7 } });
    expect(ground[1]!.action).toMatchObject({ type: 'examine' });

    const rock = optionsFor({ kind: 'rock', rock: rockFromSpec({ id: 'r', kind: 'crystal', x: 0, z: 0, radius: 3, respawnDelay: null }) });
    expect(rock.map((o) => o.label)).toEqual(['Mine', 'Examine']);
    expect(rock[0]!.action).toEqual({ type: 'mine', rockId: 'r' });
    expect(rock[1]!.action).toMatchObject({ type: 'examine', text: expect.stringContaining('crystal and stone') });
  });

  it('changes with where the item is: hold versus fitted', () => {
    const held = optionsFor({ kind: 'inventory', item: 'ice', count: 4 });
    expect(held.map((o) => o.label)).toEqual(['Examine', 'Drop']);
    expect(held[1]!.action).toEqual({ type: 'drop', item: 'ice', count: 4 });

    const fitted = optionsFor({ kind: 'equipped', itemId: 'mining-laser', group: 'beam' });
    expect(fitted.map((o) => o.label)).toEqual(['Select', 'Examine']);
    expect(fitted[0]).toMatchObject({ target: 'Beam (Mining Laser)', action: { type: 'select-group', group: 'beam' } });
  });

  it('offers Talk to only for talkable ships and nothing silly for the player', () => {
    const ship = { spec: { id: 'n', name: 'Navigator', hullName: 'Barge hauler', invulnerable: true }, stance: 'friendly' } as never;
    expect(optionsFor({ kind: 'ship', ship, talkable: true, isPlayer: false }).map((o) => o.label)).toEqual(['Talk to', 'Examine']);
    expect(optionsFor({ kind: 'ship', ship, talkable: false, isPlayer: true }).map((o) => o.label)).toEqual(['Examine']);
  });
});
