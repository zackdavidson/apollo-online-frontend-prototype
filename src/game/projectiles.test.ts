import { describe, expect, it } from 'vitest';
import { INITIAL_FLIGHT_STATE, type FlightState } from './flightController';
import { createRng } from './random';
import { ProjectilePool, aimDirection, launchVelocity, shipToWorld } from './projectiles';
import { WEAPON_PROFILES, weaponProfileFor } from './weapons';

const autocannon = WEAPON_PROFILES['weapon-autocannon']!;
const missile = WEAPON_PROFILES['weapon-missile-pod']!;
const flak = WEAPON_PROFILES['weapon-flak-cannon']!;
const rockets = WEAPON_PROFILES['weapon-rocket-pod']!;
const seeker = WEAPON_PROFILES['weapon-seeker-missiles']!;

describe('shipToWorld', () => {
  it('rotates ship-space offsets by the heading', () => {
    const facingEast: FlightState = { ...INITIAL_FLIGHT_STATE, heading: Math.PI / 2, x: 10, z: 20 };
    const [x, z] = shipToWorld(facingEast, [0, 0, 5]);
    expect(x).toBeCloseTo(15, 5);
    expect(z).toBeCloseTo(20, 5);
    const [sx, sz] = shipToWorld(facingEast, [2, 0, 0]);
    expect(sx).toBeCloseTo(10, 5);
    expect(sz).toBeCloseTo(18, 5);
  });
});

describe('weaponProfileFor', () => {
  it('maps attachment ids to profiles and falls back for unknown ids', () => {
    expect(weaponProfileFor('weapon-laser').kind).toBe('beam');
    expect(weaponProfileFor('weapon-siege-beam').beamStyle).toBe('siege');
    expect(weaponProfileFor('not-a-weapon').id).toBe('default');
    expect(weaponProfileFor(undefined).id).toBe('default');
  });
});

describe('ProjectilePool', () => {
  const mounts = [
    { position: [-1, 0, 3] as const, weapon: autocannon },
    { position: [1, 0, 3] as const, weapon: autocannon },
  ];

  it('does nothing when not firing', () => {
    const pool = new ProjectilePool(mounts, createRng(1));
    expect(pool.update(0.5, INITIAL_FLIGHT_STATE, false).fired).toHaveLength(0);
    expect(pool.projectiles).toHaveLength(0);
  });

  it('fires each mount on its own interval, staggered, and reports fire events', () => {
    const pool = new ProjectilePool(mounts, createRng(1));
    const dt = 1 / 120;
    let events = 0;
    for (let t = 0; t < 1; t += dt) events += pool.update(dt, INITIAL_FLIGHT_STATE, true).fired.length;
    const perMount = Math.floor(1 / autocannon.fireInterval);
    expect(events).toBeGreaterThanOrEqual(perMount * 2 - 1);
    expect(events).toBeLessThanOrEqual(perMount * 2 + 2);
    const xs = new Set(pool.projectiles.map((p) => Math.round(p.x)));
    expect(xs.has(-1)).toBe(true);
    expect(xs.has(1)).toBe(true);
  });

  it('gives each projectile its weapon speed, lifetime and profile, and reports expiry', () => {
    const pool = new ProjectilePool([{ position: [0, 0, 2] as const, weapon: missile }], createRng(1));
    const { fired } = pool.update(1 / 60, INITIAL_FLIGHT_STATE, true);
    expect(fired[0]?.mount.weapon.kind).toBe('missile');
    const shot = pool.projectiles[0]!;
    expect(shot.vz).toBeCloseTo(missile.speed, 5);
    expect(shot.weapon).toBe(missile);
    const { expired } = pool.update(missile.lifetime + 0.1, INITIAL_FLIGHT_STATE, false);
    expect(expired).toHaveLength(1);
    expect(pool.projectiles).toHaveLength(0);
  });

  it('falls back to a nose mount when the ship has no weapons', () => {
    const pool = new ProjectilePool([], createRng(1));
    pool.update(1 / 60, INITIAL_FLIGHT_STATE, true);
    expect(pool.projectiles).toHaveLength(1);
    expect(pool.projectiles[0]!.weapon.id).toBe('default');
  });

  it('only fires the requested group and reports readiness', () => {
    const pool = new ProjectilePool([...mounts, { position: [0, 0, 2] as const, weapon: missile }], createRng(1));
    expect(pool.countFor('guns')).toBe(2);
    expect(pool.countFor('missiles')).toBe(1);
    expect(pool.readiness('missiles')).toBe(1);
    const { fired } = pool.update(1 / 60, INITIAL_FLIGHT_STATE, 'missiles');
    expect(fired).toHaveLength(1);
    expect(fired[0]!.mount.weapon.kind).toBe('missile');
    expect(pool.readiness('missiles')).toBeLessThan(0.1);
    const guns = pool.update(1 / 60, INITIAL_FLIGHT_STATE, 'guns');
    expect(guns.fired.every((event) => event.mount.weapon.group === 'guns')).toBe(true);
  });

  it('ignores beam mounts, which are handled separately', () => {
    const pool = new ProjectilePool([{ position: [0, 0, 2] as const, weapon: WEAPON_PROFILES['weapon-laser']! }], createRng(1));
    expect(pool.update(1 / 60, INITIAL_FLIGHT_STATE, true).fired).toHaveLength(0);
    expect(pool.countFor('beam')).toBe(0);
  });

  it('spreads flak pellets across a cone', () => {
    const pool = new ProjectilePool([{ position: [0, 0, 2] as const, weapon: flak }], createRng(3));
    pool.update(1 / 60, INITIAL_FLIGHT_STATE, true);
    expect(pool.projectiles).toHaveLength(flak.pellets!);
    const angles = pool.projectiles.map((p) => Math.atan2(p.vx, p.vz));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(flak.spread! * 0.3);
    expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(flak.spread! / 2 + 1e-6);
  });

  it('fires rockets in a burst spaced by the burst gap', () => {
    const pool = new ProjectilePool([{ position: [0, 0, 2] as const, weapon: rockets }], createRng(1));
    let shots = 0;
    for (let t = 0; t < 0.5; t += 1 / 120) shots += pool.update(1 / 120, INITIAL_FLIGHT_STATE, 'missiles').fired.length;
    expect(shots).toBe(rockets.burst);
  });

  it('steers seeker missiles towards the nearest target', () => {
    const pool = new ProjectilePool([{ position: [0, 0, 2] as const, weapon: seeker }], createRng(1));
    pool.update(1 / 60, INITIAL_FLIGHT_STATE, 'missiles');
    const target = { x: 40, z: 60 };
    // Half a second: long enough to turn, short enough not to fly past the target.
    for (let t = 0; t < 0.5; t += 1 / 60) pool.update(1 / 60, INITIAL_FLIGHT_STATE, false, [target]);
    const shot = pool.projectiles[0]!;
    const toTarget = Math.atan2(target.x - shot.x, target.z - shot.z);
    const heading = Math.atan2(shot.vx, shot.vz);
    expect(Math.abs(Math.atan2(Math.sin(toTarget - heading), Math.cos(toTarget - heading)))).toBeLessThan(0.2);
    expect(Math.hypot(shot.vx, shot.vz)).toBeCloseTo(seeker.speed, 3);
  });
});

describe('aiming at the cursor', () => {
  it('points each mount at the aim point so side guns converge', () => {
    const pool = new ProjectilePool(
      [
        { position: [-4, 0, 0] as const, weapon: autocannon },
        { position: [4, 0, 0] as const, weapon: autocannon },
      ],
      createRng(1),
    );
    // A distant aim point so the shots have not crossed the centre line yet when we look.
    const aim: [number, number] = [0, 300];
    pool.update(0.08, INITIAL_FLIGHT_STATE, true, [], aim);
    pool.update(0.08, INITIAL_FLIGHT_STATE, true, [], aim);
    expect(pool.projectiles.length).toBeGreaterThan(1);
    for (const shot of pool.projectiles) {
      // Velocity points from the muzzle towards the aim point: inward in x, forward in z.
      expect(Math.sign(shot.vx)).toBe(-Math.sign(shot.x));
      expect(shot.vz).toBeGreaterThan(0);
      expect(Math.abs(shot.vx)).toBeLessThan(Math.abs(shot.vz) * 0.05);
    }
  });

  it('falls back to the heading when the aim point sits on the muzzle', () => {
    expect(aimDirection(5, 5, 0, [5.2, 5.1])).toEqual([0, 1]);
    const [dx, dz] = aimDirection(0, 0, 0, [10, 10]);
    expect(dx).toBeCloseTo(Math.SQRT1_2, 5);
    expect(dz).toBeCloseTo(Math.SQRT1_2, 5);
    expect(aimDirection(0, 0, Math.PI / 2, null)[0]).toBeCloseTo(1, 5);
  });
});

describe('launchVelocity', () => {
  it('cancels sideways ship motion so the shot flies along the aim line', () => {
    const [vx, vz] = launchVelocity(0, 1, 150, 40, 0);
    expect(vx).toBeCloseTo(0, 6);
    expect(vz).toBeCloseTo(Math.sqrt(150 * 150 - 40 * 40), 6);
  });

  it('keeps forward ship speed as extra muzzle velocity', () => {
    const [vx, vz] = launchVelocity(0, 1, 100, 0, 60);
    expect(vx).toBeCloseTo(0, 6);
    expect(vz).toBeCloseTo(160, 6);
  });

  it('does its best when the ship slides faster than the shot', () => {
    const [vx, vz] = launchVelocity(0, 1, 50, 80, 0);
    expect(vx).toBeCloseTo(30, 6);
    expect(vz).toBeCloseTo(0, 6);
  });

  it('rockets fired while strafing still fly straight at the cursor', () => {
    const pool = new ProjectilePool([{ position: [0, 0, 2] as const, weapon: rockets }], createRng(1));
    const strafing: FlightState = { ...INITIAL_FLIGHT_STATE, vx: 45 };
    pool.update(1 / 60, strafing, 'missiles', [], [0, 400]);
    const shot = pool.projectiles[0]!;
    expect(Math.abs(shot.vx)).toBeLessThan(1e-6);
    expect(shot.vz).toBeGreaterThan(100);
  });
});
