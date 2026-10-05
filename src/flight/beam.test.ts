import { describe, expect, it } from 'vitest';
import { INITIAL_BEAM_STATE, addBeamShots, beamReadout, rayCircle, stepBeam } from './beam';
import { WEAPON_PROFILES } from './weapons';

const laser = WEAPON_PROFILES['weapon-laser']!;

describe('stepBeam', () => {
  it('charges while held, fires at full charge, then cools down', () => {
    let state = INITIAL_BEAM_STATE;
    let fired = 0;
    let fireTime = -1;
    for (let t = 0; t < 3; t += 1 / 120) {
      const step = stepBeam(state, 1 / 120, true, laser);
      state = step.state;
      if (step.fire) {
        fired++;
        if (fireTime < 0) fireTime = t;
      }
    }
    expect(fireTime).toBeCloseTo(laser.chargeTime!, 1);
    // Charge + cooldown cycles: roughly 3 / (0.7 + 1.4).
    expect(fired).toBeGreaterThanOrEqual(1);
    expect(fired).toBeLessThanOrEqual(2);
  });

  it('bleeds the charge away when released early', () => {
    let state = INITIAL_BEAM_STATE;
    for (let t = 0; t < 0.3; t += 1 / 60) state = stepBeam(state, 1 / 60, true, laser).state;
    expect(state.charge).toBeGreaterThan(0.3);
    for (let t = 0; t < 0.5; t += 1 / 60) state = stepBeam(state, 1 / 60, false, laser).state;
    expect(state.charge).toBe(0);
  });

  it('expires shots and reports readouts', () => {
    const withShot = addBeamShots(INITIAL_BEAM_STATE, [{ x0: 0, z0: 0, x1: 0, z1: 10, timeLeft: 0.2, duration: 0.2 }]);
    expect(stepBeam(withShot, 0.1, false, laser).state.shots).toHaveLength(1);
    expect(stepBeam(withShot, 0.3, false, laser).state.shots).toHaveLength(0);
    expect(beamReadout(INITIAL_BEAM_STATE, laser)).toEqual({ fill: 1, phase: 'ready' });
    expect(beamReadout({ ...INITIAL_BEAM_STATE, charge: 0.4 }, laser).phase).toBe('charging');
    expect(beamReadout({ ...INITIAL_BEAM_STATE, cooldown: laser.fireInterval / 2 }, laser)).toEqual({ fill: 0.5, phase: 'cooldown' });
  });
});

describe('rayCircle', () => {
  it('returns the near intersection distance or null', () => {
    expect(rayCircle(0, 0, 0, 1, 0, 10, 2)).toBeCloseTo(8, 6);
    expect(rayCircle(0, 0, 0, 1, 5, 10, 2)).toBeNull();
    expect(rayCircle(0, 0, 0, 1, 0, -10, 2)).toBeNull();
    // Starting inside the circle counts as an immediate hit.
    expect(rayCircle(0, 0, 0, 1, 0, 1, 2)).toBe(0);
  });
});
