import { rotateToDirection, type Direction, type Vec3 } from './vector';

/**
 * Affine transform as a row-major 3x4 matrix:
 * [ r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz ].
 * Kept dependency-free so the pure core can place parts without Three.js.
 */
export interface Affine {
  readonly m: readonly number[];
}

export const IDENTITY: Affine = { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] };

export function translation([x, y, z]: Vec3): Affine {
  return { m: [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z] };
}

/** Reflection across the X = 0 plane. Flips handedness, so winding must be reversed. */
export const MIRROR_X: Affine = { m: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] };

/** Euler rotation in degrees, applied about X, then Y, then Z (world axes). */
export function rotationDegrees([rx, ry, rz]: Vec3): Affine {
  const [ax, ay, az] = [rx, ry, rz].map((d) => (d * Math.PI) / 180) as [number, number, number];
  const [cx, sx] = [Math.cos(ax), Math.sin(ax)];
  const [cy, sy] = [Math.cos(ay), Math.sin(ay)];
  const [cz, sz] = [Math.cos(az), Math.sin(az)];
  const X: Affine = { m: [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0] };
  const Y: Affine = { m: [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0] };
  const Z: Affine = { m: [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0] };
  return compose(Z, compose(Y, X));
}

/** Rotation that takes the canonical +Z axis onto `direction` (same mapping as rotateToDirection). */
export function fromDirection(direction: Direction): Affine {
  const c0 = rotateToDirection([1, 0, 0], direction);
  const c1 = rotateToDirection([0, 1, 0], direction);
  const c2 = rotateToDirection([0, 0, 1], direction);
  return { m: [c0[0], c1[0], c2[0], 0, c0[1], c1[1], c2[1], 0, c0[2], c1[2], c2[2], 0] };
}

/** Translation then rotation: the usual "place this part at `at`, turned by `rotation`". */
export function placement(at: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Affine {
  return compose(translation(at), rotationDegrees(rotation));
}

/** a ∘ b: apply b first, then a. */
export function compose(a: Affine, b: Affine): Affine {
  const A = a.m;
  const B = b.m;
  const out = new Array<number>(12);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += A[row * 4 + k]! * B[k * 4 + col]!;
      if (col === 3) sum += A[row * 4 + 3]!;
      out[row * 4 + col] = sum;
    }
  }
  return { m: out };
}

export function apply(a: Affine, [x, y, z]: Vec3): Vec3 {
  const m = a.m;
  return [
    m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
    m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
    m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
  ];
}

/** Sign of the linear part's determinant: negative means the transform mirrors. */
export function handedness(a: Affine): number {
  const m = a.m;
  const det =
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) +
    m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);
  return det < 0 ? -1 : 1;
}
