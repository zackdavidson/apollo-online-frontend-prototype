/** 3D coordinate. X = starboard, Y = up, Z = forward (nose). */
export type Vec3 = readonly [x: number, y: number, z: number];

/** Six axis-aligned directions an attachment slot can face. */
export type Direction = 'forward' | 'aft' | 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: readonly Direction[] = ['forward', 'aft', 'up', 'down', 'left', 'right'];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Unit vector pointing in the given direction. */
export function directionVector(direction: Direction): Vec3 {
  switch (direction) {
    case 'forward':
      return [0, 0, 1];
    case 'aft':
      return [0, 0, -1];
    case 'up':
      return [0, 1, 0];
    case 'down':
      return [0, -1, 0];
    case 'right':
      return [1, 0, 0];
    case 'left':
      return [-1, 0, 0];
  }
}

/**
 * Rotate a vector authored in the canonical "+Z is outward" frame so that
 * +Z points along `direction`. Attachments are authored pointing forward and
 * reoriented with this when mounted on a slot.
 */
export function rotateToDirection([x, y, z]: Vec3, direction: Direction): Vec3 {
  switch (direction) {
    case 'forward':
      return [x, y, z];
    case 'aft':
      return [neg(x), y, neg(z)];
    case 'right':
      return [z, y, neg(x)];
    case 'left':
      return [neg(z), y, x];
    case 'up':
      return [x, z, neg(y)];
    case 'down':
      return [x, neg(z), y];
  }
}

/** Negate without producing -0, which keeps equality checks tidy. */
function neg(value: number): number {
  return value === 0 ? 0 : -value;
}
