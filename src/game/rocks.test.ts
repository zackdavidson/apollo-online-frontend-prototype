import { describe, expect, it } from 'vitest';
import { INITIAL_FLIGHT_STATE } from './flightController';
import { createRng } from './random';
import { DEFAULT_ROCK_LAYOUT, ROCK_KINDS, RockField, dropsFor, hashToUnit, hitPointsFor, layoutToSpecs, rockFromSpec, type Rock, type RockSpec } from './rocks';

const spec = (overrides: Partial<RockSpec> = {}): RockSpec => ({ id: 'r1', kind: 'stone', x: 0, z: 0, radius: 4, respawnDelay: null, ...overrides });
const rock = (overrides: Partial<RockSpec> = {}): Rock => rockFromSpec(spec(overrides));

describe('RockField', () => {
  it('expands the default layout into explicit, uniquely identified specs that keep the start clear', () => {
    const specs = layoutToSpecs(DEFAULT_ROCK_LAYOUT, createRng(7), 5000);
    expect(specs.length).toBeGreaterThan(300);
    expect(new Set(specs.map((r) => r.id)).size).toBe(specs.length);
    expect(specs[0]!.id).toBe('rock-0001');
    for (const r of specs) {
      expect(Math.hypot(r.x, r.z)).toBeGreaterThanOrEqual(180);
      expect(Math.abs(r.x)).toBeLessThanOrEqual(5000);
      expect(Math.abs(r.z)).toBeLessThanOrEqual(5000);
    }
    // Deterministic: the same layout and seed give the same rocks.
    expect(layoutToSpecs(DEFAULT_ROCK_LAYOUT, createRng(7), 5000)).toEqual(specs);
    const field = RockField.generate(createRng(7), 5000);
    expect(field.rocks.every((r) => r.hp === r.maxHp)).toBe(true);
  });

  it('derives visual variation from the id, not from stored data', () => {
    const a = rockFromSpec(spec({ id: 'rock-0007' }));
    const b = rockFromSpec(spec({ id: 'rock-0007' }));
    const c = rockFromSpec(spec({ id: 'rock-0008' }));
    expect(a.seed).toBe(b.seed);
    expect(a.rotation).toBe(b.rotation);
    expect(a.seed).not.toBe(c.seed);
    expect(hashToUnit('x')).toBeGreaterThanOrEqual(0);
    expect(hashToUnit('x')).toBeLessThan(1);
    expect(() => new RockField([spec(), spec()])).toThrow(/Duplicate rock id/);
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
    const field = new RockField([spec({ x: 100, z: 50, radius: 3 }), spec({ id: 'r2', x: 120, z: 50, radius: 3 })]);
    expect(field.findAt(101, 51)?.id).toBe('r1');
    expect(field.findAt(104, 50)).toBeNull();
    expect(field.hoverAt(103.3, 50)?.id).toBe('r1');
    expect(field.hoverAt(110, 50)).toBeNull();
    expect(field.overlapping(106, 50, 4)).toHaveLength(1);
    expect(field.inView(110, 50, 15).map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(field.snapshot(100, 50, 1)[0]).toMatchObject({ id: 'r1', kind: 'stone', hp: field.get('r1')!.maxHp });
  });

  it('finds a small rock along a long segment that a point test would step over', () => {
    const field = new RockField([spec({ id: 'pebble', x: 0, z: 20, radius: 1 }), spec({ id: 'behind', x: 0, z: 60, radius: 3 })]);
    expect(field.findAt(0, 24)).toBeNull();
    const hit = field.firstAlong(0, 8, 0, 40)!;
    expect(hit.rock.id).toBe('pebble');
    expect(hit.z).toBeCloseTo(19, 5);
    expect(field.firstAlong(0, 8, 0, 100)!.rock.id).toBe('pebble');
    expect(field.firstAlong(0, 30, 0, 100)!.rock.id).toBe('behind');
    expect(field.firstAlong(5, 8, 5, 100)).toBeNull();
    // Starting inside a rock counts as hitting it where you are.
    expect(field.firstAlong(0, 20.5, 0, 25)).toMatchObject({ rock: { id: 'pebble' }, x: 0, z: 20.5 });
    expect(field.firstAlong(0, 20.5, 0, 20.5)?.rock.id).toBe('pebble');
  });

  it('respawns a mined-out rock with the same id after its delay, and never without one', () => {
    const field = new RockField([spec({ id: 'a', respawnDelay: 30 }), spec({ id: 'b', x: 50, respawnDelay: null })]);
    const a = field.get('a')!;
    const b = field.get('b')!;
    field.damage(a, a.maxHp, 10);
    field.damage(b, b.maxHp, 10);
    expect(field.rocks).toHaveLength(0);
    expect([...field.defined]).toHaveLength(2);
    expect(field.step(39)).toHaveLength(0);
    const back = field.step(40);
    expect(back.map((r) => r.id)).toEqual(['a']);
    expect(field.get('a')!.hp).toBe(a.maxHp);
    expect(field.rocks.map((r) => r.id)).toEqual(['a']);
    expect(field.findAt(0, 0)?.id).toBe('a');
    expect(field.step(10_000)).toHaveLength(0);
  });

  it('takes damage in points and simply vanishes at zero', () => {
    const field = new RockField([spec({ radius: 4 })]);
    const big = field.get('r1')!;
    expect(field.damage(big, 20).destroyed).toBe(false);
    expect(big.hp).toBe(big.maxHp - 20);
    expect(field.damage(big, 20).destroyed).toBe(false);
    expect(field.damage(big, 20).destroyed).toBe(true);
    expect(field.rocks).toHaveLength(0);
    expect(field.brokenCount).toBe(1);
    expect(field.findAt(0, 0)).toBeNull();
  });

  it('never spawns fragments, even from giants', () => {
    const field = new RockField([spec({ kind: 'giant', radius: 10 }), spec({ id: 'r2', x: 100, z: 0, radius: 1.4 })]);
    const giant = field.get('r1')!;
    field.damage(giant, giant.maxHp);
    expect(field.rocks).toHaveLength(1);
    expect(field.rocks[0]!.id).toBe('r2');
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
    const field = new RockField([spec({ x: 0, z: 10, radius: 4 })]);
    const wall = field.get('r1')!;
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
    const field = new RockField([spec({ x: 100, z: 100 })]);
    const state = { ...INITIAL_FLIGHT_STATE, vx: 5, vz: 5 };
    expect(field.collideShip(state, 3)).toEqual(state);
  });
});
