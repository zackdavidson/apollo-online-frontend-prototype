import { describe, expect, it } from 'vitest';
import { INITIAL_FLIGHT_STATE } from './flightController';
import { createRng } from './random';
import { ROCK_KINDS, RockField, dropsFor, hitPointsFor, type Rock } from './rocks';

const rock = (overrides: Partial<Rock> = {}): Rock => {
  const radius = overrides.radius ?? 4;
  const kind = overrides.kind ?? 'stone';
  const maxHp = hitPointsFor(radius, kind);
  return { id: 1, kind, x: 0, z: 0, radius, maxHp, hp: maxHp, rotation: 0, seed: 0.5, ...overrides };
};

describe('RockField', () => {
  it('generates clusters that keep the start area clear', () => {
    const field = RockField.generate(createRng(7), 5000);
    expect(field.rocks.length).toBeGreaterThan(300);
    for (const r of field.rocks) {
      expect(Math.hypot(r.x, r.z)).toBeGreaterThanOrEqual(180);
      expect(Math.abs(r.x)).toBeLessThanOrEqual(5000);
      expect(Math.abs(r.z)).toBeLessThanOrEqual(5000);
      expect(r.hp).toBe(r.maxHp);
    }
  });

  it('mixes rock kinds and includes giants', () => {
    const field = RockField.generate(createRng(7), 5000);
    const kinds = new Set(field.rocks.map((r) => r.kind));
    for (const kind of Object.keys(ROCK_KINDS)) expect(kinds.has(kind as keyof typeof ROCK_KINDS), kind).toBe(true);
    const giants = field.rocks.filter((r) => r.kind === 'giant');
    expect(giants.length).toBeGreaterThanOrEqual(7);
    expect(giants.every((r) => r.radius >= 8 && r.maxHp > 250)).toBe(true);
  });

  it('gives rocks a substantial health pool scaled by toughness', () => {
    expect(hitPointsFor(1.3)).toBeGreaterThanOrEqual(25);
    expect(hitPointsFor(5.5)).toBeGreaterThanOrEqual(70);
    expect(hitPointsFor(4, 'iron')).toBeGreaterThan(hitPointsFor(4, 'stone'));
    expect(hitPointsFor(4, 'ice')).toBeLessThan(hitPointsFor(4, 'stone'));
  });

  it('finds rocks by point and hover without any stepping', () => {
    const field = new RockField([rock({ x: 100, z: 50, radius: 3 }), rock({ id: 2, x: 120, z: 50, radius: 3 })]);
    expect(field.findAt(101, 51)?.id).toBe(1);
    expect(field.findAt(104, 50)).toBeNull();
    expect(field.hoverAt(103.3, 50)?.id).toBe(1);
    expect(field.hoverAt(110, 50)).toBeNull();
    expect(field.overlapping(106, 50, 4)).toHaveLength(1);
  });

  it('takes damage in points and simply vanishes at zero', () => {
    const big = rock({ radius: 4 });
    const field = new RockField([big]);
    expect(field.damage(big, 20).destroyed).toBe(false);
    expect(big.hp).toBe(big.maxHp - 20);
    expect(field.damage(big, 20).destroyed).toBe(false);
    expect(field.damage(big, 20).destroyed).toBe(true);
    expect(field.rocks).toHaveLength(0);
    expect(field.brokenCount).toBe(1);
    expect(field.findAt(0, 0)).toBeNull();
  });

  it('never spawns fragments, even from giants', () => {
    const giant = rock({ kind: 'giant', radius: 10 });
    const field = new RockField([giant, rock({ id: 2, x: 100, z: 0, radius: 1.4 })]);
    field.damage(giant, giant.maxHp);
    expect(field.rocks).toHaveLength(1);
    expect(field.rocks[0]!.id).toBe(2);
  });

  it('drops resources matching the kind, scaled by a mining bonus', () => {
    const rng = createRng(5);
    expect(dropsFor(rock({ kind: 'stone', radius: 5 }), rng)).toEqual({ ore: 6 });
    expect(dropsFor(rock({ kind: 'crystal', radius: 4 }), rng).crystal).toBe(3);
    expect(dropsFor(rock({ kind: 'ice', radius: 3 }), rng, 2).ice).toBe(8);
    const giant = dropsFor(rock({ kind: 'giant', radius: 10 }), rng);
    expect(giant.ore).toBe(25);
    expect(giant.iron).toBe(10);
  });

  it('stops the ship against a rock instead of bouncing, and never moves the rock', () => {
    const wall = rock({ x: 0, z: 10, radius: 4 });
    const field = new RockField([wall]);
    const incoming = { ...INITIAL_FLIGHT_STATE, x: 0, z: 5, vx: 12, vz: 30 };
    const { state, impactSpeed } = field.resolveShipCollision(incoming, 3);
    expect(state.z).toBeLessThanOrEqual(10 - 4 - 3 + 1e-6);
    expect(state.vz).toBeLessThanOrEqual(1e-6);
    expect(state.vz).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.abs(state.vx)).toBeLessThan(12);
    expect(impactSpeed).toBeCloseTo(30, 5);
    expect(wall.x).toBe(0);
    expect(wall.z).toBe(10);
  });

  it('leaves a ship alone when nothing overlaps', () => {
    const field = new RockField([rock({ x: 100, z: 100 })]);
    const state = { ...INITIAL_FLIGHT_STATE, vx: 5, vz: 5 };
    expect(field.collideShip(state, 3)).toEqual(state);
  });
});
