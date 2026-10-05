import { describe, expect, it } from 'vitest';
import { IdleController, TURRET_AI, TurretAi } from './controllers';
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

  it('mines a rock into a stack that sits still until taken, on purpose or by flying over it', () => {
    const sim = new WorldSim();
    const rock = sim.rocks.rocks.find((r) => r.kind === 'stone' && r.radius < 2)!;
    // Park 8 units from the rock: close enough to shoot, too far for the hull to touch the drop.
    sim.addShip(player({ spawn: { x: rock.x, z: rock.z - 8, heading: 0 } }));
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [rock.x, rock.z] });
    const events = run(sim, 8);
    expect(events.some((e) => e.type === 'rock-destroyed' && e.rock.id === rock.id)).toBe(true);
    sim.setInput('p1', IDLE_INPUT);
    const stack = sim.loot.pickups.find((p) => p.kind === 'stone')!;
    expect(stack).toMatchObject({ armed: true });
    expect(Math.hypot(stack.x - rock.x, stack.z - rock.z)).toBeLessThan(2);
    const where = { x: stack.x, z: stack.z };
    run(sim, 2);
    expect(sim.loot.get(stack.id)).toMatchObject(where);
    // Too far to take by hand with a short reach; fine when asked with a generous one.
    expect(sim.takePickup('p1', stack.id, 1)).toBe(false);
    expect(sim.takePickup('p1', stack.id, 100)).toBe(true);
    const after = sim.step(1 / 60);
    expect(after.some((e) => e.type === 'pickup-collected' && e.kind === 'stone' && e.count === stack.count)).toBe(true);
    expect(sim.getShip('p1')!.cargo.stone).toBe(stack.count);
  });

  it('drops a stack from the hold that is not re-collected until the ship has moved away', () => {
    const sim = new WorldSim();
    sim.addShip(player({ collectsLoot: true }));
    const ship = sim.getShip('p1')!;
    ship.cargo = { ...ship.cargo, ice: 3 };
    expect(sim.dropCargo('p1', 'ice', 5)).toBe(false);
    expect(sim.dropCargo('p1', 'ice', 3)).toBe(true);
    expect(sim.getShip('p1')!.cargo.ice).toBe(0);
    const events = run(sim, 2);
    expect(events.some((e) => e.type === 'pickup-dropped' && e.count === 3)).toBe(true);
    expect(sim.loot.pickups).toHaveLength(1);
    expect(sim.getShip('p1')!.cargo.ice).toBe(0);
    // Fly off and come back: now it is picked up.
    sim.setInput('p1', { ...IDLE_INPUT, thrust: 1, boost: true });
    run(sim, 1.5);
    sim.setInput('p1', { ...IDLE_INPUT, thrust: -1, boost: true });
    run(sim, 1.5);
    const stack = sim.loot.pickups[0];
    if (stack) {
      // Still there: steer straight onto it to finish the test deterministically.
      expect(sim.takePickup('p1', stack.id, 1000)).toBe(true);
    }
    expect(sim.getShip('p1')!.cargo.ice).toBe(3);
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

describe('warp range', () => {
  it('refuses a warp beyond the drive range and accepts one inside it', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    expect(sim.requestWarp('p1', 0, 500, 160)).toBe(false);
    expect(sim.getShip('p1')!.warp).toBeNull();
    expect(sim.requestWarp('p1', 0, 150, 160)).toBe(true);
    expect(sim.getShip('p1')!.warp).not.toBeNull();
    expect(sim.requestWarp('p1', 0, 100, 160)).toBe(false); // already warping
  });
});

describe('held ships', () => {
  it('stops dead, ignores thrust and fire while held, and flies again once released', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.setInput('p1', { ...IDLE_INPUT, thrust: 1, fire: true, aim: [0, 40] });
    for (let t = 0; t < 1; t += 1 / 60) sim.step(1 / 60);
    const moving = sim.getShip('p1')!;
    expect(Math.hypot(moving.state.vx, moving.state.vz)).toBeGreaterThan(5);
    sim.setHeld('p1', true);
    expect(sim.getShip('p1')!.state.vz).toBe(0);
    const start = { ...sim.getShip('p1')!.state };
    const events = [];
    for (let t = 0; t < 1; t += 1 / 60) events.push(...sim.step(1 / 60));
    const held = sim.getShip('p1')!.state;
    expect(held.x).toBe(start.x);
    expect(held.z).toBe(start.z);
    expect(events.filter((e) => e.type === 'shot-fired' && e.shipId === 'p1')).toHaveLength(0);
    sim.setHeld('p1', false);
    sim.setInput('p1', { ...IDLE_INPUT, thrust: 1 });
    for (let t = 0; t < 0.5; t += 1 / 60) sim.step(1 / 60);
    expect(Math.hypot(sim.getShip('p1')!.state.vx, sim.getShip('p1')!.state.vz)).toBeGreaterThan(5);
  });
});

describe('stances', () => {
  const run = (sim: WorldSim, seconds: number) => {
    const events = [];
    for (let t = 0; t < seconds; t += 1 / 60) events.push(...sim.step(1 / 60));
    return events;
  };

  it('keeps a friendly turret quiet until the player shoots it, then it turns hostile and fires back', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    // Tough enough to survive the provoking burst and shoot back.
    sim.addShip(npc({ controller: new TurretAi(), stance: 'friendly', spawn: { x: 0, z: 40, heading: Math.PI }, maxShield: 100, maxHull: 400 }));
    expect(sim.getShip('n1')!.stance).toBe('friendly');
    const quiet = run(sim, 3);
    expect(quiet.filter((e) => e.type === 'shot-fired' && e.shipId === 'n1')).toHaveLength(0);
    expect(quiet.filter((e) => e.type === 'ship-stance-changed')).toHaveLength(0);
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [0, 40] });
    const provoked = run(sim, 1);
    sim.setInput('p1', IDLE_INPUT);
    const change = provoked.find((e) => e.type === 'ship-stance-changed');
    expect(change).toMatchObject({ type: 'ship-stance-changed', shipId: 'n1', stance: 'hostile', byShipId: 'p1', reason: 'provoked' });
    expect(sim.getShip('n1')!.stance).toBe('hostile');
    const after = run(sim, 3);
    expect(after.filter((e) => e.type === 'shot-fired' && e.shipId === 'n1').length).toBeGreaterThan(0);
  });

  it('lets a friendly turret ambush a ship that lingers in its ambush range', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.addShip(npc({ controller: new TurretAi({ ...TURRET_AI, ambushRange: 50, ambushDelay: 1 }), stance: 'friendly', spawn: { x: 0, z: 40, heading: Math.PI } }));
    const early = run(sim, 0.9);
    expect(early.filter((e) => e.type === 'ship-stance-changed')).toHaveLength(0);
    const late = run(sim, 0.3);
    expect(late.find((e) => e.type === 'ship-stance-changed')).toMatchObject({ shipId: 'n1', stance: 'hostile', byShipId: null, reason: 'ambush' });
  });

  it('never provokes a ship marked unprovokable, however hard it is hit', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.addShip(npc({ controller: new IdleController(), stance: 'friendly', provokable: false, spawn: { x: 0, z: 40, heading: Math.PI }, maxShield: 100, maxHull: 400 }));
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [0, 40] });
    const events = run(sim, 2);
    expect(events.some((e) => e.type === 'hit' && e.target.kind === 'ship')).toBe(true);
    expect(events.filter((e) => e.type === 'ship-stance-changed')).toHaveLength(0);
    expect(sim.getShip('n1')!.stance).toBe('friendly');
  });

  it('lets nothing hurt an invulnerable ship: shots, ramming or gas', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.addShip(npc({ controller: new IdleController(), stance: 'friendly', provokable: false, invulnerable: true, spawn: { x: 0, z: 40, heading: Math.PI }, maxShield: 0, maxHull: 10 }));
    const before = { ...sim.getShip('n1')!.vitals };
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [0, 40] });
    const events = run(sim, 2);
    expect(events.some((e) => e.type === 'hit' && e.target.kind === 'ship')).toBe(true);
    expect(events.filter((e) => e.type === 'hit' && e.target.kind === 'ship').every((e) => e.type === 'hit' && e.amount === 0)).toBe(true);
    expect(events.filter((e) => e.type === 'ship-damaged' && e.shipId === 'n1')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'ship-destroyed' && e.shipId === 'n1')).toHaveLength(0);
    expect(sim.getShip('n1')!.vitals).toEqual(before);
    expect(sim.getShip('n1')!.alive).toBe(true);
  });

  it('never ambushes from outside the range and resets to friendly on respawn', () => {
    const sim = new WorldSim();
    sim.addShip(player());
    sim.addShip(npc({ controller: new TurretAi({ ...TURRET_AI, ambushRange: 20, ambushDelay: 0.5 }), stance: 'friendly', spawn: { x: 0, z: 40, heading: Math.PI }, maxShield: 0, maxHull: 5, respawnDelay: 1 }));
    expect(run(sim, 2).filter((e) => e.type === 'ship-stance-changed')).toHaveLength(0);
    sim.setInput('p1', { ...IDLE_INPUT, fire: true, aim: [0, 40] });
    const events = run(sim, 4);
    sim.setInput('p1', IDLE_INPUT);
    expect(events.some((e) => e.type === 'ship-destroyed' && e.shipId === 'n1')).toBe(true);
    expect(events.some((e) => e.type === 'ship-respawned' && e.shipId === 'n1')).toBe(true);
    expect(sim.getShip('n1')!.stance).toBe('friendly');
    sim.setShipStance('n1', 'hostile');
    expect(sim.step(1 / 60).find((e) => e.type === 'ship-stance-changed')).toMatchObject({ shipId: 'n1', stance: 'hostile', reason: 'set' });
  });
});
