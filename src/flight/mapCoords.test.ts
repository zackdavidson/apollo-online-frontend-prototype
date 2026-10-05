import { describe, expect, it } from 'vitest';
import { formatMapCoords, fromMapCoords, headingBearing, rotateScreen, toMapCoords, worldVectorToMap } from './mapCoords';

describe('map coordinates', () => {
  it('puts the bottom-left corner at 0,0 and the centre at half,half', () => {
    // Bottom-left on screen is world (+half, -half): screen-right is -X.
    expect(toMapCoords(5000, -5000, 5000)).toEqual({ x: 0, y: 0 });
    expect(toMapCoords(0, 0, 5000)).toEqual({ x: 5000, y: 5000 });
    expect(toMapCoords(-5000, 5000, 5000)).toEqual({ x: 10000, y: 10000 });
  });

  it('increases x when the ship moves to screen-right (world -X) and y when it moves up (world +Z)', () => {
    const start = toMapCoords(0, 0, 5000);
    const right = toMapCoords(-8, 0, 5000);
    const up = toMapCoords(0, 12, 5000);
    expect(right.x).toBeGreaterThan(start.x);
    expect(up.y).toBeGreaterThan(start.y);
  });

  it('round-trips', () => {
    const world = fromMapCoords(1234, 8765, 5000);
    expect(toMapCoords(world.x, world.z, 5000)).toEqual({ x: 1234, y: 8765 });
    expect(formatMapCoords(0, 0, 5000)).toBe('5000, 5000');
  });
});

describe('bearings and screen rotation', () => {
  it('reads world heading 0 as north and +90 degrees as west', () => {
    expect(headingBearing(0)).toBe(0);
    expect(headingBearing(Math.PI / 2)).toBeCloseTo(270, 6);
    expect(headingBearing(-Math.PI / 2)).toBeCloseTo(90, 6);
    expect(headingBearing(Math.PI)).toBeCloseTo(180, 6);
  });

  it('rotates screen vectors clockwise', () => {
    const [x, y] = rotateScreen(0, -1, Math.PI / 2); // up, turned clockwise, points right
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it('maps world vectors into the map frame', () => {
    expect(worldVectorToMap(1, 0)).toEqual([-1, 0]);
    expect(worldVectorToMap(0, 1)).toEqual([0, 1]);
  });
});
