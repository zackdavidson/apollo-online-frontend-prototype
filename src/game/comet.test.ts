import { describe, expect, it } from 'vitest';
import { COMET_TUNING, cometCollideShip, damageComet, spawnComet, stepComet } from './comet';
import { INITIAL_FLIGHT_STATE } from './flightController';
import { createRng } from './random';

describe('comet', () => {
  it('spawns the first comet near the start, heading across the map at the tuned speed', () => {
    const comet = spawnComet(createRng(3), 5000, true);
    expect(Math.hypot(comet.x, comet.z)).toBeCloseTo(COMET_TUNING.startDistance, 5);
    expect(Math.hypot(comet.vx, comet.vz)).toBeCloseTo(COMET_TUNING.speed, 5);
    // Heading roughly inward: velocity points against the position vector.
    expect(comet.x * comet.vx + comet.z * comet.vz).toBeLessThan(0);
    expect(comet.hp).toBe(COMET_TUNING.maxHp);
    expect(comet.alive).toBe(true);
  });

  it('spawns later comets outside the map edge, heading inward', () => {
    for (let seed = 1; seed < 20; seed++) {
      const comet = spawnComet(createRng(seed), 5000, false);
      expect(Math.hypot(comet.x, comet.z)).toBeGreaterThan(5000);
      expect(comet.x * comet.vx + comet.z * comet.vz).toBeLessThan(0);
    }
  });

  it('moves slowly, leaves the map, and a new one enters after the delay', () => {
    let comet = { ...spawnComet(createRng(4), 5000, true), x: 5000 + COMET_TUNING.exitMargin - 1, z: 0, vx: 10, vz: 0 };
    let step = stepComet(comet, 0.5, 100, 5000, createRng(5));
    expect(step.left).toBe(true);
    expect(step.comet.alive).toBe(false);
    comet = step.comet;
    step = stepComet(comet, 1, 110, 5000, createRng(5));
    expect(step.entered).toBe(false);
    step = stepComet(comet, 1, 100 + COMET_TUNING.respawnDelay + 1, 5000, createRng(5));
    expect(step.entered).toBe(true);
    expect(step.comet.alive).toBe(true);
    expect(step.comet.hp).toBe(COMET_TUNING.maxHp);
  });

  it('sheds a chunk every chunkEvery damage and bursts at zero', () => {
    let comet = spawnComet(createRng(6), 5000, true);
    let chunks = 0;
    for (let i = 0; i < 5; i++) {
      const hit = damageComet(comet, 50, 0);
      comet = hit.comet;
      chunks += hit.chunks;
    }
    // 250 damage at 120 per chunk: two chunks, 10 carried over.
    expect(chunks).toBe(2);
    expect(comet.minedSinceChunk).toBe(10);
    expect(comet.hp).toBe(COMET_TUNING.maxHp - 250);
    const final = damageComet(comet, 10000, 50);
    expect(final.destroyed).toBe(true);
    expect(final.comet.alive).toBe(false);
    expect(final.comet.respawnAt).toBe(50 + COMET_TUNING.respawnDelay);
    expect(damageComet(final.comet, 10, 51).destroyed).toBe(false);
  });

  it('carries a ship that flies into it instead of bouncing it off', () => {
    const comet = { ...spawnComet(createRng(7), 5000, true), x: 0, z: 10, vx: 5, vz: 0 };
    const incoming = { ...INITIAL_FLIGHT_STATE, x: 0, z: 2, vx: 0, vz: 30 };
    const { state, impactSpeed } = cometCollideShip(incoming, comet, 3);
    expect(impactSpeed).toBeCloseTo(30, 5);
    expect(state.z).toBeLessThanOrEqual(10 - comet.radius - 3 + 1e-6);
    // No speed into the comet. Relative sideways motion (-5) is scrubbed to 60%, so the
    // ship ends up partly carried along: 5 + (-5 * 0.6) = 2.
    expect(state.vz).toBeCloseTo(0, 5);
    expect(state.vx).toBeCloseTo(2, 5);
    expect(cometCollideShip({ ...incoming, z: -50 }, comet, 3).state).toEqual({ ...incoming, z: -50 });
  });
});
