import { describe, expect, it } from 'vitest';
import { WARP_TUNING, easeInOutCubic, planWarp, sampleWarp, warpDuration } from './warp';

describe('warp', () => {
  it('scales tunnel time with distance and clamps it', () => {
    expect(warpDuration(0)).toBe(WARP_TUNING.minTravel);
    expect(warpDuration(2200)).toBeCloseTo(WARP_TUNING.baseTravel + 1, 6);
    expect(warpDuration(9000)).toBeCloseTo(WARP_TUNING.baseTravel + 9000 / 2200, 6);
    expect(warpDuration(1e6)).toBe(WARP_TUNING.maxTravel);
    expect(warpDuration(5000)).toBeGreaterThan(warpDuration(1000));
  });

  it('ignores clicks on top of the ship', () => {
    expect(planWarp(0, 0, 1, 1, 0)).toBeNull();
    expect(planWarp(0, 0, 100, 0, 0)).not.toBeNull();
  });

  it('runs charge, blank-out, tunnel, fade-in, done, moving the ship only once blanked', () => {
    const plan = planWarp(0, 0, 0, 2200, 10)!;
    expect(plan.chargeUntil).toBeCloseTo(10 + WARP_TUNING.chargeTime, 6);
    expect(plan.blankAt).toBeCloseTo(plan.chargeUntil + WARP_TUNING.fadeIn, 6);
    expect(plan.arriveAt).toBeCloseTo(plan.blankAt + WARP_TUNING.baseTravel + 1, 6);
    expect(plan.doneAt).toBeCloseTo(plan.arriveAt + WARP_TUNING.fadeOut, 6);

    const charging = sampleWarp(plan, 10.2);
    expect(charging.phase).toBe('charging');
    expect(charging.overlay).toBe(0);
    expect(charging.atDestination).toBe(false);

    const entering = sampleWarp(plan, plan.chargeUntil + WARP_TUNING.fadeIn / 2);
    expect(entering.phase).toBe('entering');
    expect(entering.overlay).toBeGreaterThan(0);
    expect(entering.overlay).toBeLessThan(1);
    expect(entering.atDestination).toBe(false);

    const tunnel = sampleWarp(plan, plan.blankAt + 0.5);
    expect(tunnel.phase).toBe('tunnel');
    expect(tunnel.overlay).toBe(1);
    expect(tunnel.atDestination).toBe(true);
    expect(tunnel.intensity).toBeGreaterThan(0.3);

    const exiting = sampleWarp(plan, plan.arriveAt + WARP_TUNING.fadeOut / 2);
    expect(exiting.phase).toBe('exiting');
    expect(exiting.overlay).toBeLessThan(1);
    expect(exiting.atDestination).toBe(true);

    expect(sampleWarp(plan, plan.doneAt).phase).toBe('done');
  });

  it('easing is monotonic from 0 to 1', () => {
    let previous = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const value = easeInOutCubic(Math.min(1, p));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });
});
