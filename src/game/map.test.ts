import { describe, expect, it } from 'vitest';
import type { GameEvent } from './events';
import { MapParseError, defaultMapDefinition, generateMapRocks, parseMapDefinition, provingGroundMapDefinition, resolveMap } from './map';
import { RockField } from './rocks';
import { WorldSim } from './simulation';
import { WEAPON_PROFILES } from './weapons';

describe('parseMapDefinition', () => {
  it('accepts the default map round-tripped through JSON', () => {
    const def = defaultMapDefinition();
    const parsed = parseMapDefinition(JSON.parse(JSON.stringify(def)));
    expect(parsed).toEqual(def);
  });

  it('fills defaults for a tiny payload', () => {
    const parsed = parseMapDefinition({ name: 'Tiny', size: 4000, objects: [{ type: 'beacon', x: 2000, y: 3000, label: 'Gate' }] });
    expect(parsed.name).toBe('Tiny');
    expect(parsed.size).toBe(4000);
    expect(parsed.spawn).toEqual({ x: 2000, y: 2000, heading: 0 });
    expect(parsed.scenery.stars.length).toBeGreaterThan(0);
    // Rocks default to the starter sector's explicit list.
    expect(parsed.rocks.length).toBeGreaterThan(300);
    expect(parsed.comet.enabled).toBe(true);
    expect(parsed.objects[0]).toMatchObject({ type: 'beacon', id: 'beacon-0', label: 'Gate', radius: 12, colour: '#6fd3ff' });
  });

  it('turns the comet off with null or false', () => {
    expect(parseMapDefinition({ comet: null }).comet.enabled).toBe(false);
    expect(parseMapDefinition({ comet: false }).comet.enabled).toBe(false);
  });

  it('reads an explicit rock list, filling ids and defaults, and rejects duplicate ids', () => {
    const parsed = parseMapDefinition({ rocks: [{ x: 100, y: 100, kind: 'iron' }, { id: 'big-one', x: 50, y: 50, kind: 'giant', radius: 11, respawn: null }, { x: 1, y: 2, respawn: 30 }] });
    expect(parsed.rocks).toEqual([
      { id: 'rock-0001', x: 100, y: 100, kind: 'iron', radius: 3, respawn: 120 },
      { id: 'big-one', x: 50, y: 50, kind: 'giant', radius: 11, respawn: null },
      { id: 'rock-0003', x: 1, y: 2, kind: 'stone', radius: 3, respawn: 30 },
    ]);
    expect(parseMapDefinition({ rocks: [] }).rocks).toEqual([]);
    expect(() => parseMapDefinition({ rocks: [{ id: 'a', x: 1, y: 1 }, { id: 'a', x: 2, y: 2 }] })).toThrow(/map\.rocks\[1\]\.id.*duplicate/);
    expect(() => parseMapDefinition({ rocks: [{ x: 1, y: 1, kind: 'cheese' }] })).toThrow(/map\.rocks\[0\]\.kind/);
  });

  it('expands a "generate" recipe into explicit rocks at parse time, deterministically by seed', () => {
    const payload = { size: 6000, seed: 11, spawn: { x: 1000, y: 1000 }, rocks: { generate: { clusters: [{ x: 3000, y: 3000, radius: 100, count: 20, kind: 'iron' }], giants: [{ x: 500, y: 5500 }], scatter: { clusters: 2, giants: 1 }, respawn: null } } };
    const parsed = parseMapDefinition(payload);
    expect(Array.isArray(parsed.rocks)).toBe(true);
    expect(parsed.rocks.length).toBeGreaterThan(20);
    expect(new Set(parsed.rocks.map((r) => r.id)).size).toBe(parsed.rocks.length);
    expect(parsed.rocks.every((r) => r.respawn === null)).toBe(true);
    expect(parsed.rocks.filter((r) => r.kind === 'giant')).toHaveLength(2);
    expect(parsed.rocks.find((r) => r.kind === 'giant' && r.x === 500 && r.y === 5500)).toMatchObject({ radius: 10 });
    for (const r of parsed.rocks) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x).toBeLessThanOrEqual(6000);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThanOrEqual(6000);
    }
    // Same payload, same rocks; the saved form is the explicit list, so re-parsing it is a no-op.
    expect(parseMapDefinition(payload).rocks).toEqual(parsed.rocks);
    expect(parseMapDefinition(JSON.parse(JSON.stringify(parsed))).rocks).toEqual(parsed.rocks);
    expect(parseMapDefinition({ ...payload, seed: 12 }).rocks).not.toEqual(parsed.rocks);
  });

  it('exposes the generator for editors and keeps generated rocks clear of the spawn', () => {
    const rocks = generateMapRocks({ clusters: [], giants: [], scatter: { clusters: 4, perCluster: 30, clusterRadius: 200, keepClear: 180, giants: 2 }, respawn: 60 }, 3, 6000, { x: 1000, y: 1000 });
    expect(rocks.length).toBeGreaterThan(50);
    for (const rock of rocks) {
      if (rock.kind === 'giant') continue;
      expect(Math.hypot(rock.x - 1000, rock.y - 1000)).toBeGreaterThanOrEqual(180);
    }
  });

  it('reads gas clouds with defaults and resolves them into world-space hazards', () => {
    const parsed = parseMapDefinition({ size: 4000, objects: [{ type: 'gas-cloud', x: 1000, y: 3000 }, { type: 'gas-cloud', id: 'acid', x: 2000, y: 2000, radius: 90, damagePerSecond: 25, label: 'Acid cloud', colour: '#ff0' }] });
    expect(parsed.objects).toEqual([
      { type: 'gas-cloud', id: 'gas-0', x: 1000, y: 3000, radius: 60, damagePerSecond: 10, label: 'Toxic gas', colour: '#9bff3d' },
      { type: 'gas-cloud', id: 'acid', x: 2000, y: 2000, radius: 90, damagePerSecond: 25, label: 'Acid cloud', colour: '#ff0' },
    ]);
    const resolved = resolveMap(parsed);
    expect(resolved.hazards).toEqual([
      { id: 'gas-0', kind: 'gas', x: 1000, z: 1000, radius: 60, label: 'Toxic gas', colour: '#9bff3d', damagePerSecond: 10 },
      { id: 'acid', kind: 'gas', x: 0, z: 0, radius: 90, label: 'Acid cloud', colour: '#ff0', damagePerSecond: 25 },
    ]);
    expect(resolveMap(defaultMapDefinition()).hazards.length).toBeGreaterThan(0);
    expect(() => parseMapDefinition({ objects: [{ type: 'gas-cloud', x: 1, y: 1, radius: 'big' }] })).toThrow(/map\.objects\[0\]\.radius/);
  });

  it('reads minimap markers with defaults and validates icon names', () => {
    const parsed = parseMapDefinition({ size: 4000, markers: [{ type: 'label', x: 100, y: 200, text: 'Here' }, { type: 'icon', x: 4000, y: 0, icon: 'mine', label: 'Ore' }] });
    expect(parsed.markers).toEqual([
      { type: 'label', x: 100, y: 200, text: 'Here', colour: '#dfe6f2', size: 11, onMinimap: false },
      { type: 'icon', x: 4000, y: 0, icon: 'mine', label: 'Ore', colour: null, onMinimap: true },
    ]);
    const resolved = resolveMap(parsed);
    expect(resolved.markers[0]).toMatchObject({ type: 'label', x: 1900, z: -1800 });
    expect(resolved.markers[1]).toMatchObject({ type: 'icon', x: -2000, z: -2000, icon: 'mine' });
    expect(() => parseMapDefinition({ markers: [{ type: 'icon', x: 1, y: 1, icon: 'dragon' }] })).toThrow(/map\.markers\[0\]\.icon/);
    expect(() => parseMapDefinition({ markers: [{ type: 'note', x: 1, y: 1 }] })).toThrow(/map\.markers\[0\]\.type/);
    expect(() => parseMapDefinition({ markers: [{ type: 'label', x: 1, y: 1 }] })).toThrow(/map\.markers\[0\]\.text/);
    expect(provingGroundMapDefinition().markers.length).toBeGreaterThan(3);
  });

  it('rejects bad input with the offending path', () => {
    expect(() => parseMapDefinition(null)).toThrow(MapParseError);
    expect(() => parseMapDefinition({ size: 'big' })).toThrow(/map\.size/);
    expect(() => parseMapDefinition({ size: 100 })).toThrow(/at least 500/);
    expect(() => parseMapDefinition({ objects: [{ type: 'portal', x: 1, y: 1 }] })).toThrow(/map\.objects\[0\]\.type/);
    expect(() => parseMapDefinition({ objects: [{ type: 'rock', x: 1, y: 1 }] })).toThrow(/map\.objects\[0\]\.type/);
    expect(() => parseMapDefinition({ rocks: { clusters: [] } })).toThrow(/map\.rocks\.generate/);
    expect(() => parseMapDefinition({ objects: [{ type: 'cache', x: 1, y: 1, resource: 'gold' }] })).toThrow(/resource/);
    expect(() => parseMapDefinition({ scenery: { planets: [{ x: 1, y: 2 }] } })).toThrow(/planets\[0\]\.art/);
    expect(() => parseMapDefinition({ version: 2 })).toThrow(/version/);
  });
});

describe('provingGroundMapDefinition', () => {
  it('is a small explicit map with a clear spawn and a clear bottom-left corner for the raider', () => {
    const map = provingGroundMapDefinition();
    expect(map.size).toBe(500);
    expect(map.spawn).toEqual({ x: 250, y: 250, heading: 0 });
    expect(parseMapDefinition(JSON.parse(JSON.stringify(map)))).toEqual(map);
    expect(map.rocks.length).toBeGreaterThanOrEqual(12);
    expect(new Set(map.rocks.map((r) => r.id)).size).toBe(map.rocks.length);
    for (const rock of map.rocks) {
      expect(rock.x).toBeGreaterThan(0);
      expect(rock.x).toBeLessThan(500);
      expect(rock.y).toBeGreaterThan(0);
      expect(rock.y).toBeLessThan(500);
      expect(Math.hypot(rock.x - 250, rock.y - 250)).toBeGreaterThan(30);
      expect(Math.hypot(rock.x - 60, rock.y - 60)).toBeGreaterThan(60);
    }
    expect(map.comet.enabled).toBe(false);
    expect(map.objects.filter((o) => o.type === 'gas-cloud')).toHaveLength(1);
    const resolved = resolveMap(map);
    expect(resolved.halfExtent).toBe(250);
    expect(resolved.hazards[0]).toMatchObject({ id: 'drift', radius: 45 });
    const sim = new WorldSim(resolved);
    expect(sim.rocks.rocks.length).toBe(map.rocks.length);
  });
});

describe('resolveMap', () => {
  it('converts map coordinates (bottom-left origin) into world coordinates', () => {
    const resolved = resolveMap(parseMapDefinition({ size: 4000, spawn: { x: 0, y: 0 }, objects: [{ type: 'beacon', x: 4000, y: 4000, label: 'Far' }, { type: 'cache', x: 2000, y: 2000, resource: 'ice', count: 3 }] }));
    expect(resolved.halfExtent).toBe(2000);
    // Bottom-left on screen is world (+half, -half): screen-right is -X.
    expect(resolved.spawn).toMatchObject({ x: 2000, z: -2000 });
    expect(resolved.beacons[0]).toMatchObject({ x: -2000, z: 2000, label: 'Far' });
    expect(resolved.caches[0]).toMatchObject({ x: 0, z: 0, resource: 'ice', count: 3 });
  });

  it('places every explicit rock exactly where the map says, keyed by its id', () => {
    const resolved = resolveMap(parseMapDefinition({ size: 6000, spawn: { x: 1000, y: 1000 }, rocks: [{ id: 'gem', x: 3000, y: 3000, kind: 'crystal', radius: 4 }, { id: 'edge', x: 0, y: 0, respawn: null }] }));
    expect(resolved.rockSpecs).toEqual([
      { id: 'gem', kind: 'crystal', x: 0, z: 0, radius: 4, respawnDelay: 120 },
      { id: 'edge', kind: 'stone', x: 3000, z: -3000, radius: 3, respawnDelay: null },
    ]);
    const field = new RockField(resolved.rockSpecs);
    expect(field.get('gem')).toMatchObject({ kind: 'crystal', x: 0, z: 0 });
    expect(field.findAt(0.5, 0.5)?.id).toBe('gem');
  });
});

describe('WorldSim from a map', () => {
  it('spawns caches as permanent pickups, fires beacons once per visit and can run without a comet', () => {
    const resolved = resolveMap(
      parseMapDefinition({
        size: 4000,
        spawn: { x: 2000, y: 2000 },
        rocks: [],
        comet: null,
        objects: [
          { type: 'cache', x: 2000, y: 2060, resource: 'crystal', count: 4 },
          { type: 'beacon', id: 'gate', x: 2000, y: 2100, label: 'Gate', radius: 15 },
        ],
      }),
    );
    const sim = new WorldSim(resolved);
    expect(sim.comet.alive).toBe(false);
    expect(sim.loot.pickups).toHaveLength(1);
    expect(sim.loot.pickups[0]!.count).toBe(4);
    expect(sim.pick(sim.loot.pickups[0]!.x, sim.loot.pickups[0]!.z)).toMatchObject({ kind: 'pickup', pickup: { kind: 'crystal', count: 4 } });
    expect(sim.loot.pickups.every((pickup) => pickup.life === Infinity)).toBe(true);
    sim.addShip({ id: 'p', name: 'P', hullName: 'h', team: 't', radius: 3, weaponMounts: [], maxShield: 1, maxHull: 1, spawn: resolved.spawn, respawnDelay: 1, collectsLoot: true });
    sim.setInput('p', { thrust: 1, strafe: 0, boost: false, aim: null, fire: false });
    const events = [];
    for (let t = 0; t < 4; t += 1 / 60) events.push(...sim.step(1 / 60));
    expect(events.filter((e) => e.type === 'beacon-reached')).toHaveLength(1);
    expect(sim.getShip('p')!.cargo.crystal).toBe(4);
    expect(sim.comet.alive).toBe(false);
    expect(sim.pick(resolved.beacons[0]!.x, resolved.beacons[0]!.z)).toMatchObject({ kind: 'beacon' });
  });

  it('hurts a ship for as long as it sits in a gas cloud, shields first, and stops when it leaves', () => {
    const resolved = resolveMap(parseMapDefinition({ size: 4000, spawn: { x: 2000, y: 2000 }, rocks: [], comet: null, objects: [{ type: 'gas-cloud', id: 'cloud', x: 2000, y: 2000, radius: 40, damagePerSecond: 10 }] }));
    const sim = new WorldSim(resolved);
    expect(sim.pick(resolved.spawn.x + 30, resolved.spawn.z)).toMatchObject({ kind: 'hazard', hazard: { id: 'cloud' } });
    expect(sim.pick(resolved.spawn.x + 50, resolved.spawn.z)).toBeNull();
    sim.addShip({ id: 'p', name: 'P', hullName: 'h', team: 't', radius: 3, weaponMounts: [], maxShield: 20, maxHull: 100, spawn: resolved.spawn, respawnDelay: 1 });
    const events: GameEvent[] = [];
    for (let t = 0; t < 1.05; t += 1 / 60) events.push(...sim.step(1 / 60));
    expect(events.filter((e) => e.type === 'hazard-entered')).toHaveLength(1);
    const ticks = events.filter((e) => e.type === 'hazard-damage');
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.every((e) => e.type === 'hazard-damage' && e.amount === 5 && e.shipId === 'p')).toBe(true);
    const ship = sim.getShip('p')!;
    expect(ship.vitals.shield).toBe(20 - 5 * ticks.length);
    expect(ship.vitals.hull).toBe(100);
    expect(sim.hazards.insideFor('p').map((h) => h.id)).toEqual(['cloud']);
    // Fly out: the ticks stop and hazard-left fires once.
    sim.setInput('p', { thrust: 1, strafe: 0, boost: true, aim: null, fire: false });
    const later: GameEvent[] = [];
    for (let t = 0; t < 4; t += 1 / 60) later.push(...sim.step(1 / 60));
    expect(later.filter((e) => e.type === 'hazard-left')).toHaveLength(1);
    expect(sim.hazards.insideFor('p')).toEqual([]);
    const hullAfter = sim.getShip('p')!.vitals.hull;
    const more: GameEvent[] = [];
    for (let t = 0; t < 1; t += 1 / 60) more.push(...sim.step(1 / 60));
    expect(more.filter((e) => e.type === 'hazard-damage')).toHaveLength(0);
    expect(sim.getShip('p')!.vitals.hull).toBe(hullAfter);
  });

  it('kills a ship that stays in a cloud with no attacker credited, and re-enters when it respawns inside', () => {
    const resolved = resolveMap(parseMapDefinition({ size: 4000, spawn: { x: 2000, y: 2000 }, rocks: [], comet: null, objects: [{ type: 'gas-cloud', id: 'cloud', x: 2000, y: 2000, radius: 40, damagePerSecond: 40 }] }));
    const sim = new WorldSim(resolved);
    sim.addShip({ id: 'p', name: 'P', hullName: 'h', team: 't', radius: 3, weaponMounts: [], maxShield: 10, maxHull: 30, spawn: resolved.spawn, respawnDelay: 1 });
    const events: GameEvent[] = [];
    for (let t = 0; t < 3; t += 1 / 60) events.push(...sim.step(1 / 60));
    const deaths = events.filter((e) => e.type === 'ship-destroyed');
    expect(deaths.length).toBeGreaterThanOrEqual(1);
    expect(deaths[0]).toMatchObject({ type: 'ship-destroyed', shipId: 'p', byShipId: null });
    // Dead ships are not inside anything; the respawn lands back in the cloud and fires entered again.
    expect(events.filter((e) => e.type === 'hazard-entered').length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === 'hazard-left')).toHaveLength(0);
  });

  it('mines a rock out, reports it by id, and brings it back after its respawn delay', () => {
    const resolved = resolveMap(parseMapDefinition({ size: 4000, spawn: { x: 2000, y: 2000 }, rocks: [{ id: 'target', x: 2000, y: 2040, kind: 'stone', radius: 2, respawn: 5 }], comet: null }));
    const sim = new WorldSim(resolved);
    const rock = sim.rocks.get('target')!;
    expect(sim.pick(rock.x, rock.z)).toEqual({ kind: 'rock', rockId: 'target' });
    expect(sim.rocks.snapshot(resolved.spawn.x, resolved.spawn.z, 100)).toEqual([{ id: 'target', kind: 'stone', x: rock.x, z: rock.z, radius: 2, hp: rock.maxHp, maxHp: rock.maxHp }]);
    sim.addShip({ id: 'p', name: 'P', hullName: 'h', team: 't', radius: 3, weaponMounts: [{ position: [0, 0, 3], weapon: WEAPON_PROFILES['weapon-autocannon']! }], maxShield: 1, maxHull: 1, spawn: resolved.spawn, respawnDelay: 1 });
    sim.setInput('p', { thrust: 0, strafe: 0, boost: false, aim: [rock.x, rock.z], fire: true });
    const events: GameEvent[] = [];
    let t = 0;
    for (; t < 12 && !events.some((e) => e.type === 'rock-destroyed'); t += 1 / 60) events.push(...sim.step(1 / 60));
    const destroyed = events.find((e) => e.type === 'rock-destroyed');
    expect(destroyed).toMatchObject({ type: 'rock-destroyed', rock: { id: 'target' } });
    expect(sim.rocks.rocks).toHaveLength(0);
    expect(sim.rocks.snapshot(resolved.spawn.x, resolved.spawn.z, 100)).toEqual([]);
    // The rock is gone; what is left under the cursor is the stack it dropped, never the rock.
    expect(sim.pick(rock.x, rock.z)?.kind).not.toBe('rock');
    sim.setInput('p', { thrust: 0, strafe: 0, boost: false, aim: null, fire: false });
    const later: GameEvent[] = [];
    for (let dt = 0; dt < 5.2; dt += 1 / 60) later.push(...sim.step(1 / 60));
    expect(later.filter((e) => e.type === 'rock-respawned')).toEqual([{ type: 'rock-respawned', rock: sim.rocks.get('target') }]);
    expect(sim.rocks.get('target')!.hp).toBe(rock.maxHp);
    expect(sim.pick(rock.x, rock.z)).toEqual({ kind: 'rock', rockId: 'target' });
  });
});
