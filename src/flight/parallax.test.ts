import { describe, expect, it } from 'vitest';
import { parallaxFactor, tileOrigin } from './parallax';

describe('parallaxFactor', () => {
  it('is 1 on the ship plane and shrinks with depth', () => {
    expect(parallaxFactor(70, 0)).toBeCloseTo(1, 6);
    expect(parallaxFactor(70, -70)).toBeCloseTo(0.5, 6);
    expect(parallaxFactor(70, -630)).toBeCloseTo(0.1, 6);
  });

  it('exceeds 1 for content above the plane and is clamped', () => {
    expect(parallaxFactor(70, 14)).toBeGreaterThan(1);
    expect(parallaxFactor(70, 69.9999)).toBeLessThanOrEqual(2.5);
    expect(parallaxFactor(70, -1e9)).toBeGreaterThanOrEqual(0.004);
  });
});

describe('tileOrigin', () => {
  it('snaps to the tile containing the coordinate, including negatives', () => {
    expect(tileOrigin(0, 100)).toBe(0);
    expect(tileOrigin(99.9, 100)).toBe(0);
    expect(tileOrigin(100, 100)).toBe(100);
    expect(tileOrigin(-0.1, 100)).toBe(-100);
    expect(tileOrigin(-250, 100)).toBe(-300);
  });
});
