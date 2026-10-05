import { describe, expect, it } from 'vitest';
import { HAZARD_TICK, HazardTracker, type Hazard } from './hazards';

const cloud = (overrides: Partial<Hazard> = {}): Hazard => ({
  id: 'cloud',
  kind: 'gas',
  x: 0,
  z: 0,
  radius: 50,
  label: 'Toxic gas',
  colour: '#9bff3d',
  damagePerSecond: 10,
  ...overrides,
});

describe('HazardTracker', () => {
  it('fires entered with an immediate tick, then ticks on a fixed cadence until you leave', () => {
    const tracker = new HazardTracker([cloud()]);
    const first = tracker.update('p', 10, 0, 1.0);
    expect(first.entered.map((h) => h.id)).toEqual(['cloud']);
    expect(first.ticks).toEqual([{ hazard: cloud(), amount: 10 * HAZARD_TICK }]);
    expect(tracker.insideFor('p').map((h) => h.id)).toEqual(['cloud']);

    expect(tracker.update('p', 10, 0, 1.2).ticks).toHaveLength(0);
    expect(tracker.update('p', 10, 0, 1.49).ticks).toHaveLength(0);
    expect(tracker.update('p', 10, 0, 1.5).ticks).toHaveLength(1);
    expect(tracker.update('p', 10, 0, 1.6).ticks).toHaveLength(0);

    const out = tracker.update('p', 60, 0, 1.7);
    expect(out.left.map((h) => h.id)).toEqual(['cloud']);
    expect(out.ticks).toHaveLength(0);
    expect(tracker.insideFor('p')).toEqual([]);
    // Nothing more once outside, and coming back fires entered again.
    expect(tracker.update('p', 60, 0, 5)).toEqual({ entered: [], left: [], ticks: [] });
    expect(tracker.update('p', 0, 0, 6).entered).toHaveLength(1);
  });

  it('catches up missed ticks after a long step but never explodes', () => {
    const tracker = new HazardTracker([cloud()]);
    tracker.update('p', 0, 0, 0);
    expect(tracker.update('p', 0, 0, 2.0).ticks).toHaveLength(4); // 0.5, 1.0, 1.5, 2.0
    expect(tracker.update('p', 0, 0, 1000).ticks.length).toBeLessThanOrEqual(20);
  });

  it('treats an inactive ship (dead or warping) as outside, so respawning inside fires entered again', () => {
    const tracker = new HazardTracker([cloud()]);
    tracker.update('p', 0, 0, 0);
    const dead = tracker.update('p', 0, 0, 0.1, false);
    expect(dead.left).toHaveLength(1);
    expect(dead.ticks).toHaveLength(0);
    expect(tracker.insideFor('p')).toEqual([]);
    expect(tracker.update('p', 0, 0, 3).entered).toHaveLength(1);
  });

  it('tracks ships and hazards independently and answers hover queries', () => {
    const tracker = new HazardTracker([cloud(), cloud({ id: 'far', x: 500, damagePerSecond: 20 })]);
    tracker.update('a', 0, 0, 0);
    tracker.update('b', 500, 0, 0);
    expect(tracker.insideFor('a').map((h) => h.id)).toEqual(['cloud']);
    expect(tracker.insideFor('b').map((h) => h.id)).toEqual(['far']);
    expect(tracker.update('b', 500, 0, 0.5).ticks[0]?.amount).toBe(10);
    expect(tracker.at(20, 20)?.id).toBe('cloud');
    expect(tracker.at(490, 0)?.id).toBe('far');
    expect(tracker.at(200, 0)).toBeNull();
  });
});
