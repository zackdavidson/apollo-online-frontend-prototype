import { describe, expect, it } from 'vitest';
import { PoseBuffer } from './interpolation';

const at = (x: number, heading = 0, vx = 0) => ({ x, z: 0, vx, vz: 0, heading, throttle: 0 });

describe('PoseBuffer', () => {
  it('returns null when empty and the only sample otherwise', () => {
    const buffer = new PoseBuffer();
    expect(buffer.sample(1)).toBeNull();
    buffer.push(1, at(5));
    expect(buffer.sample(0)?.x).toBe(5);
    expect(buffer.sample(1)?.x).toBe(5);
  });

  it('interpolates between samples and wraps headings the short way', () => {
    const buffer = new PoseBuffer();
    buffer.push(0, at(0, 3));
    buffer.push(1, at(10, -3));
    expect(buffer.sample(0.5)?.x).toBeCloseTo(5);
    // From +3 to -3 radians is a 0.28 rad turn through pi, not a 6 rad turn back.
    expect(Math.abs(buffer.sample(0.5)!.heading)).toBeCloseTo(Math.PI, 2);
  });

  it('extrapolates along the last velocity, but only briefly', () => {
    const buffer = new PoseBuffer();
    buffer.push(0, at(0, 0, 10));
    expect(buffer.sample(0.1)?.x).toBeCloseTo(1);
    expect(buffer.sample(5)?.x).toBeCloseTo(2.5);
  });

  it('keeps samples sorted when they arrive out of order and trims old ones', () => {
    const buffer = new PoseBuffer();
    buffer.push(2, at(20));
    buffer.push(1, at(10));
    buffer.push(3, at(30));
    expect(buffer.sample(1.5)?.x).toBeCloseTo(15);
    buffer.trim(2.5);
    expect(buffer.size).toBe(2);
    expect(buffer.sample(2.5)?.x).toBeCloseTo(25);
    buffer.reset();
    expect(buffer.size).toBe(0);
  });
});
