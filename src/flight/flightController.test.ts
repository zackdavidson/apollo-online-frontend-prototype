import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, IDLE_INPUT, INITIAL_FLIGHT_STATE, forwardVector, speedOf, stepFlight, wrapAngle, type FlightState } from './flightController';

function run(state: FlightState, input: Partial<typeof IDLE_INPUT>, seconds: number, dt = 1 / 120): FlightState {
  let current = state;
  for (let t = 0; t < seconds; t += dt) current = stepFlight(current, { ...IDLE_INPUT, ...input }, dt);
  return current;
}

describe('stepFlight', () => {
  it('stays put with no input', () => {
    const state = run(INITIAL_FLIGHT_STATE, {}, 1);
    expect(state.x).toBe(0);
    expect(state.z).toBe(0);
    expect(state.heading).toBe(0);
  });

  it('accelerates along the heading under thrust and reaches a capped speed', () => {
    const state = run(INITIAL_FLIGHT_STATE, { thrust: 1 }, 4);
    expect(state.z).toBeGreaterThan(50);
    expect(Math.abs(state.x)).toBeLessThan(1e-6);
    expect(speedOf(state)).toBeLessThanOrEqual(DEFAULT_TUNING.maxSpeed + 1e-6);
    expect(speedOf(state)).toBeGreaterThan(DEFAULT_TUNING.maxSpeed * 0.8);
  });

  it('boost goes faster than plain thrust', () => {
    const plain = run(INITIAL_FLIGHT_STATE, { thrust: 1 }, 3);
    const boosted = run(INITIAL_FLIGHT_STATE, { thrust: 1, boost: true }, 3);
    expect(speedOf(boosted)).toBeGreaterThan(speedOf(plain) * 1.2);
  });

  it('coasts to a stop when input is released', () => {
    const moving = run(INITIAL_FLIGHT_STATE, { thrust: 1 }, 2);
    const stopped = run(moving, {}, 4);
    expect(speedOf(stopped)).toBeLessThan(speedOf(moving) * 0.05);
  });

  it('strafes to starboard (the pilot\'s right, -X at heading 0) with positive strafe', () => {
    const state = run(INITIAL_FLIGHT_STATE, { strafe: 1 }, 1);
    expect(state.x).toBeLessThan(-5);
    expect(Math.abs(state.z)).toBeLessThan(1e-6);
  });

  it('turns towards the aim point at a limited rate', () => {
    const quarter = stepFlight(INITIAL_FLIGHT_STATE, { ...IDLE_INPUT, aim: [100, 0] }, 1 / 60);
    expect(quarter.heading).toBeCloseTo(DEFAULT_TUNING.turnRate / 60, 6);
    const settled = run(INITIAL_FLIGHT_STATE, { aim: [100, 0] }, 1);
    expect(settled.heading).toBeCloseTo(Math.PI / 2, 5);
    const [fx, fz] = forwardVector(settled.heading);
    expect(fx).toBeCloseTo(1, 5);
    expect(fz).toBeCloseTo(0, 5);
  });

  it('takes the short way round when turning', () => {
    const facingBack: FlightState = { ...INITIAL_FLIGHT_STATE, heading: Math.PI * 0.9 };
    const next = stepFlight(facingBack, { ...IDLE_INPUT, aim: [0, -100 * Math.cos(0.3), 0] as unknown as [number, number] }, 1 / 60);
    // Aim is straight behind-ish; heading should move further from 0, i.e. towards ±π.
    expect(Math.abs(wrapAngle(next.heading))).toBeGreaterThan(Math.PI * 0.9 - 1e-6);
  });

  it('keeps the ship inside the map and kills outward velocity', () => {
    const nearEdge: FlightState = { ...INITIAL_FLIGHT_STATE, z: DEFAULT_TUNING.halfExtent - 1 };
    const state = run(nearEdge, { thrust: 1 }, 2);
    expect(state.z).toBe(DEFAULT_TUNING.halfExtent);
    expect(state.vz).toBeLessThanOrEqual(0);
  });

  it('ramps throttle up under thrust and back down at idle', () => {
    const thrusting = run(INITIAL_FLIGHT_STATE, { thrust: 1 }, 1);
    expect(thrusting.throttle).toBeGreaterThan(0.9);
    const idle = run(thrusting, {}, 2);
    expect(idle.throttle).toBeLessThan(0.2);
  });
});
