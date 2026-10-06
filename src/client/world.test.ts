import { describe, expect, it } from 'vitest';
import { createDefaultCatalog } from '../catalog/catalog';
import { provingGroundMapDefinition, resolveMap } from '../game/map';
import { createShipState } from '../state/shipState';
import { EntityType, Varps } from './definitions';
import type { EntityAppearance } from './messages';
import { ClientWorld } from './world';

const catalog = createDefaultCatalog();
const build = createShipState(catalog.getHull('hull-fighter'));
const movement = { teleport: false, x: 0, z: 0, vx: 0, vz: 0, heading: 0, throttle: 0 };

function appearance(extra: Partial<EntityAppearance> = {}): EntityAppearance {
  return { entityType: EntityType.SHIP, name: 'Pilot', hullName: 'Dart fighter', team: 'players', radius: 3, build, accent: '#ff6a3a', invulnerable: false, provokable: true, talkRange: null, maxShield: 60, maxHull: 100, ...extra };
}

function world(): ClientWorld {
  const w = new ClientWorld(catalog);
  w.setMap(resolveMap(provingGroundMapDefinition()));
  w.apply({ type: 'login-response', status: 'ok', message: '', playerIndex: 1, serverTime: 0, tick: 0.05 });
  w.apply({ type: 'player-info', t: 0, entities: [{ index: 1, appearance: appearance(), movement, status: { alive: true, hostile: false, held: false } }] });
  return w;
}

describe('ClientWorld', () => {
  it('knows its own entity after login and an appearance, with mounts from the build', () => {
    const w = world();
    expect(w.playerIndex).toBe(1);
    expect(w.player?.appearance?.name).toBe('Pilot');
    expect(w.player?.mounts.length).toBeGreaterThan(0);
    expect(w.player?.vitals).toMatchObject({ shield: 60, maxShield: 60, hull: 100, maxHull: 100 });
  });

  it('interpolates movement between ticks, honours teleports and turns in place', () => {
    const w = world();
    w.apply({ type: 'player-info', t: 1, entities: [{ index: 1, movement: { ...movement, x: 0 } }] });
    w.apply({ type: 'player-info', t: 2, entities: [{ index: 1, movement: { ...movement, x: 10 } }] });
    w.advance(1.5);
    expect(w.player?.pose.x).toBeCloseTo(5);
    w.apply({ type: 'player-info', t: 2.5, entities: [{ index: 1, movement: { ...movement, teleport: true, x: 100 } }] });
    expect(w.player?.pose.x).toBe(100);
    expect(w.player?.poses.size).toBe(1);
    w.apply({ type: 'player-info', t: 3, entities: [{ index: 1, face: 1.5 }] });
    w.advance(3);
    expect(w.player?.pose.heading).toBeCloseTo(1.5);
    expect(w.player?.pose.x).toBe(100);
  });

  it('applies status, hits and removal', () => {
    const w = world();
    w.apply({ type: 'player-info', t: 1, entities: [{ index: 1, hit: { amount: 15, kind: 'normal', absorbed: false, x: 0, z: 0, shield: 0, hull: 85 } }] });
    expect(w.player?.vitals).toMatchObject({ shield: 0, hull: 85, lastHitAt: 1 });
    w.apply({ type: 'player-info', t: 2, entities: [{ index: 1, status: { alive: false, hostile: true, held: true } }] });
    expect(w.player).toMatchObject({ alive: false, hostile: true, held: true });
    w.apply({ type: 'player-info', t: 3, entities: [{ index: 1, remove: true }] });
    expect(w.player).toBeNull();
  });

  it('treats the comet as an NPC and reads its health from hull', () => {
    const w = world();
    expect(w.comet).toBeNull();
    w.apply({ type: 'npc-info', t: 1, entities: [{ index: 50, appearance: appearance({ entityType: EntityType.COMET, name: 'Comet', radius: 6, maxShield: 0, maxHull: 2400 }), movement: { ...movement, x: 10, vx: 14 } }] });
    expect(w.comet).toMatchObject({ index: 50, x: 10, hp: 2400, maxHp: 2400, radius: 6 });
    expect([...w.ships()].map((s) => s.index)).toEqual([1]);
    w.apply({ type: 'npc-info', t: 2, entities: [{ index: 50, hit: { amount: 100, kind: 'normal', absorbed: false, x: 0, z: 0, shield: 0, hull: 2300 } }] });
    expect(w.comet?.hp).toBe(2300);
  });

  it('flies projectiles from start to end or to a target, then forgets them', () => {
    const w = world();
    w.apply({ type: 'npc-info', t: 0, entities: [{ index: 9, appearance: appearance({ name: 'Raider', team: 'raiders' }), movement: { ...movement, x: 100, z: 0 } }] });
    w.advance(0);
    w.apply({ type: 'map-projanim', id: 5, item: 'weapon-autocannon', x0: 0, z0: 0, y: 0.5, x1: 50, z1: 0, target: null, delay: 0, duration: 1 });
    w.apply({ type: 'map-projanim', id: 6, item: 'weapon-seeker-missiles', x0: 0, z0: 0, y: 0.5, x1: 0, z1: 0, target: 9, delay: 0, duration: 2 });
    w.advance(0.5);
    expect(w.projectilePosition(w.projectiles.get(5)!)).toMatchObject({ x: 25, progress: 0.5 });
    expect(w.projectilePosition(w.projectiles.get(6)!).x).toBeCloseTo(25);
    w.apply({ type: 'npc-info', t: 0.5, entities: [{ index: 9, movement: { ...movement, teleport: true, x: 200, z: 0 } }] });
    w.advance(1);
    expect(w.projectilePosition(w.projectiles.get(6)!).x).toBeCloseTo(100);
    w.advance(1.1);
    expect(w.projectiles.has(5)).toBe(false);
    expect(w.projectiles.has(6)).toBe(true);
    w.apply({ type: 'proj-del', id: 6 });
    expect(w.projectiles.size).toBe(0);
  });

  it('keeps rock health by id on top of the map', () => {
    const w = world();
    const rock = [...w.rocks!.defined][0]!;
    w.apply({ type: 'loc-health', id: rock.id, hp: 1 });
    expect(rock.hp).toBe(1);
    w.apply({ type: 'loc-del', id: rock.id });
    expect(rock.hp).toBe(0);
    w.apply({ type: 'loc-add', id: rock.id });
    expect(rock.hp).toBe(rock.maxHp);
    expect(w.apply({ type: 'loc-del', id: 'nope' })).toBe(true);
  });

  it('adds and removes ground items, replaces the hold wholesale, and keeps stats and varps', () => {
    const w = world();
    w.apply({ type: 'obj-add', index: 9, item: 'crystal', count: 2, x: 1, z: 2, permanent: true });
    expect(w.groundItems.get(9)).toMatchObject({ kind: 'crystal', count: 2, life: Infinity });
    w.apply({ type: 'obj-add', index: 10, item: '', count: 2, x: 1, z: 2, permanent: false });
    expect(w.groundItems.has(10)).toBe(false);
    w.apply({ type: 'obj-del', index: 9 });
    expect(w.groundItems.size).toBe(0);
    w.apply({ type: 'update-inv-full', items: [{ item: 'iron-ore', count: 4 }, { item: 'crystal', count: 1 }] });
    expect(w.cargo).toEqual({ stone: 0, 'iron-ore': 4, ice: 0, crystal: 1 });
    w.apply({ type: 'update-stat', stat: 'mining', level: 3, base: 2 });
    expect(w.talents).toEqual([{ id: 'mining', level: 3, base: 2 }]);
    w.apply({ type: 'varp', id: Varps.KILLS, value: 4 });
    w.apply({ type: 'varp', id: Varps.BEAM_CHARGE, value: 500 });
    w.apply({ type: 'varp', id: Varps.ACTIVE_WEAPON_GROUP, value: 2 });
    expect(w.varp(Varps.KILLS)).toBe(4);
    expect(w.beamCharge).toBe(0.5);
    expect(w.activeWeaponGroup).toBe('missiles');
    w.apply({ type: 'set-map-flag', flag: { x: 5, z: 6 } });
    expect(w.mapFlag).toEqual({ x: 5, z: 6 });
  });

  it('stores a warp plan and forgets it once the plan is over', () => {
    const w = world();
    const plan = { fromX: 0, fromZ: 0, toX: 100, toZ: 0, distance: 100, heading: 0, startAt: 0, chargeUntil: 0.45, blankAt: 0.75, arriveAt: 1.5, doneAt: 2 };
    w.apply({ type: 'player-info', t: 0, entities: [{ index: 1, warp: plan }] });
    expect(w.player?.warp).toEqual(plan);
    w.advance(2.1);
    expect(w.player?.warp).toBeNull();
  });

  it('reports messages no mechanic owns', () => {
    expect(world().apply({ type: 'nonsense' } as never)).toBe(false);
  });
});
