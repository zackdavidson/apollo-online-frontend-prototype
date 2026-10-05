import { describe, expect, it } from 'vitest';
import { IdleController, TurretAi } from './controllers';
import { IDLE_INPUT } from './flightController';
import { WorldSim } from './simulation';
import { WEAPON_PROFILES } from './weapons';
import type { ShipSpec } from './world';

const autocannon = WEAPON_PROFILES['weapon-autocannon']!;

function player(overrides: Partial<ShipSpec> = {}): ShipSpec {
  return {
    id: 'p1',
    name: 'Pilot',
    hullName: 'Dart fighter',
    team: 'players',
    radius: 3,
    weaponMounts: [{ position: [0, 0, 4], weapon: autocannon }],
    maxShield: 60,
    maxHull: 100,
    spawn: { x: 0, z: 0, heading: 0 },
    respawnDelay: 2,
    collectsLoot: true,
    ...overrides,
  };
}

function npc(overrides: Partial<ShipSpec> = {}): ShipSpec {
  return {
    id: 'n1',
    name: 'Raider',
    hullName: 'Bastion gunship',
    team: 'raiders',
    radius: 4,
    weaponMounts: [{ position: [0, 0, 4], weapon: autocannon }],
    maxShield: 10,
    maxHull: 20,
    spawn: { x: 0, z: 40, heading: Math.PI },
    respawnDelay: 5,
    tuning: { turnRate: 1.2 },
    damageScale: 0.35,
    controller: new IdleController(),
    ...overrides,
  };
}

function run(sim: WorldSim, seconds: number, dt = 1 / 60) {
  const events = [];
  for (let t = 0; t < seconds; t += dt) events.push(...sim.step(dt));
  return events;
}

describe('WorldSim', () => {
  it('adds and removes ships by id and reports weapon status', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    expect(sim.getShip('p1')?.alive).toBe(true);
    expect(() => sim.addShip(player())).toThrow(/already exists/);
    const guns = sim.weaponStatus('p1').find((group) => group.id === 'guns');
    expect(guns?.mounts).toBe(1);
    expect(guns?.active).toBe(true);
    sim.removeShip('p1');
    expect(sim.getShip('p1')).toBeUndefined();
  });

  it('moves a ship under input and respects the map bounds', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.setInput('p1', { ...IDLE_INPUT, thrust: 1 });
    run(sim, 2);
    const ship = sim.getShip('p1')!;
    expect(ship.state.z).toBeGreaterThan(40);
    expect(Math.abs(ship.state.z)).toBeLessThanOrEqual(sim.halfExtent);
  });

  it('lets a ship shoot an enemy, emitting hit events and crediting the kill', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.addShip(npc());
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [0, 40] });
    const events = run(sim, 3);
    const hits = events.filter((e) => e.type === 'hit' && e.target.kind === 'ship');
    expect(hits.length).toBeGreaterThan(3);
    const destroyed = events.find((e) => e.type === 'ship-destroyed');
    expect(destroyed).toMatchObject({ type: 'ship-destroyed', shipId: 'n1', byShipId: 'p1' });
    expect(sim.getShip('p1')?.kills).toBe(1);
    expect(sim.getShip('n1')?.alive).toBe(false);
    // Respawns after its delay with full vitals.
    sim.setInput('p1', IDLE_INPUT);
    const later = run(sim, 6);
    expect(later.some((e) => e.type === 'ship-respawned' && e.shipId === 'n1')).toBe(true);
    expect(sim.getShip('n1')?.vitals.hull).toBe(20);
  });

  it('removes ships without a respawn delay when they die', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.addShip(npc({ respawnDelay: null }));
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [0, 40] });
    const events = run(sim, 6);
    expect(events.some((e) => e.type === 'ship-removed' && e.shipId === 'n1')).toBe(true);
    expect(sim.getShip('n1')).toBeUndefined();
  });

  it('never lets teammates hurt each other', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.addShip(npc({ team: 'players' }));
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [0, 40] });
    const events = run(sim, 3);
    expect(events.some((e) => e.type === 'hit' && e.target.kind === 'ship')).toBe(false);
  });

  it('a turret AI turns on the player and shoots back', () => {
    const sim = new WorldSim();
    sim.addShip(player({ spawn: { x: 0, z: 0, heading: 0 } }));
    sim.addShip(npc({ controller: new TurretAi(), spawn: { x: 0, z: 60, heading: 0 } }));
    const events = run(sim, 8);
    const incoming = events.filter((e) => e.type === 'hit' && e.target.kind === 'ship' && e.target.shipId === 'p1');
    expect(incoming.length).toBeGreaterThan(0);
    expect(sim.getShip('p1')!.vitals.shield).toBeLessThan(60);
  });

  it('mines a rock into pickups and collects them', () => {
    const sim = new WorldSim();
    const rock = sim.rocks.rocks.find((r) => r.kind === 'stone' && r.radius < 2)!;
    // Park right next to the rock, facing it.
    sim.addShip(player({ spawn: { x: rock.x, z: rock.z - 8, heading: 0 } }));
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [rock.x, rock.z] });
    const events = run(sim, 8);
    expect(events.some((e) => e.type === 'rock-destroyed' && e.rock.id === rock.id)).toBe(true);
    expect(events.some((e) => e.type === 'pickup-collected' && e.kind === 'ore')).toBe(true);
    expect(sim.getShip('p1')!.cargo.ore).toBeGreaterThan(0);
  });

  it('warps a ship with blank-out, moving it only once covered', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    expect(sim.requestWarp('p1', 0, 1500)).toBe(true);
    expect(sim.requestWarp('p1', 0, 2000)).toBe(false);
    const early = run(sim, 0.3);
    expect(early.some((e) => e.type === 'warp-started')).toBe(true);
    expect(sim.getShip('p1')!.state.z).toBe(0);
    const later = run(sim, 4);
    expect(later.some((e) => e.type === 'warp-blanked')).toBe(true);
    expect(later.some((e) => e.type === 'warp-done')).toBe(true);
    expect(sim.getShip('p1')!.state.z).toBe(1500);
    expect(sim.getShip('p1')!.warp).toBeNull();
  });

  it('picks what is under a point', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    expect(sim.pick(0, 1)).toMatchObject({ kind: 'ship' });
    const rock = sim.rocks.rocks[0]!;
    expect(sim.pick(rock.x, rock.z)).toEqual({ kind: 'rock', rockId: rock.id });
    expect(sim.pick(sim.comet.x, sim.comet.z)).toEqual({ kind: 'comet' });
    expect(sim.pick(2500, -2500)).toBeNull();
  });
});
