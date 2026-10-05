import type { Primitive, Section, SectionShape, SegmentPrimitive, WingPrimitive } from './geometry';
import type { PaletteRole } from './palette';
import type { Vec3 } from './vector';

/**
 * Readable constructors for the primitives in `geometry.ts`. Catalog files
 * use these so a hull reads like a parts list rather than a vertex dump.
 */

interface Common {
  readonly role: PaletteRole;
  readonly at?: Vec3;
  readonly rotation?: Vec3;
  readonly mirror?: boolean;
}

/** A box (or chamfered / hexagonal prism) of `size` [width, height, length] centred on `at`. */
export function box(
  options: Common & { readonly size: Vec3; readonly shape?: SectionShape; readonly chamfer?: number; readonly caps?: readonly [boolean, boolean] },
): SegmentPrimitive {
  const [width, height, length] = options.size;
  return {
    kind: 'segment',
    shape: options.shape ?? 'box',
    ...(options.chamfer !== undefined ? { chamfer: options.chamfer } : {}),
    from: { width, height },
    to: { width, height },
    z: [-length / 2, length / 2],
    role: options.role,
    ...(options.caps ? { caps: options.caps } : {}),
    ...placementOf(options),
  };
}

/** A sweep from one cross-section to another between two Z values (in the part frame, before `at`). */
export function taper(
  options: Common & {
    readonly from: Section;
    readonly to: Section;
    readonly z: readonly [number, number];
    readonly shape?: SectionShape;
    readonly chamfer?: number;
    readonly caps?: readonly [boolean, boolean];
  },
): SegmentPrimitive {
  return {
    kind: 'segment',
    shape: options.shape ?? 'chamfered',
    ...(options.chamfer !== undefined ? { chamfer: options.chamfer } : {}),
    from: options.from,
    to: options.to,
    z: options.z,
    role: options.role,
    ...(options.caps ? { caps: options.caps } : {}),
    ...placementOf(options),
  };
}

/**
 * A cylinder (or truncated cone with two radii) along the local Z axis,
 * optionally re-aimed along X or Y.
 */
export function tube(
  options: Common & {
    readonly radius: number | readonly [number, number];
    readonly z: readonly [number, number];
    readonly axis?: 'x' | 'y' | 'z';
    readonly caps?: readonly [boolean, boolean];
  },
): SegmentPrimitive {
  const [r0, r1] = typeof options.radius === 'number' ? [options.radius, options.radius] : options.radius;
  const axisRotation: Vec3 = options.axis === 'x' ? [0, 90, 0] : options.axis === 'y' ? [-90, 0, 0] : [0, 0, 0];
  const rotation = options.rotation ?? axisRotation;
  return {
    kind: 'segment',
    shape: 'round',
    from: { width: r0 * 2, height: r0 * 2 },
    to: { width: r1 * 2, height: r1 * 2 },
    z: options.z,
    role: options.role,
    ...(options.caps ? { caps: options.caps } : {}),
    ...placementOf({ ...options, rotation }),
  };
}

/** A cone from `radius` at z[0] to a point at z[1]. */
export function cone(options: Common & { readonly radius: number; readonly z: readonly [number, number]; readonly axis?: 'x' | 'y' | 'z' }): SegmentPrimitive {
  return tube({ ...options, radius: [options.radius, 0] });
}

/** A convex planform in the XZ plane with a given (optionally tapering) thickness. */
export function wing(
  options: Common & { readonly points: ReadonlyArray<readonly [number, number]>; readonly thickness: number | readonly [number, number] },
): WingPrimitive {
  return { kind: 'wing', points: options.points, thickness: options.thickness, role: options.role, ...placementOf(options) };
}

/**
 * A thin panel: `size` is [extent along the first in-plane axis, extent along
 * the second], and `facing` is the axis the plate's thin side points along.
 * Facing x: size = [z extent, y extent]. Facing y: [x, z]. Facing z: [x, y].
 */
export function plate(
  options: Common & { readonly size: readonly [number, number]; readonly facing: 'x' | 'y' | 'z'; readonly thickness?: number },
): SegmentPrimitive {
  const t = options.thickness ?? 0.06;
  const [a, b] = options.size;
  const size: Vec3 = options.facing === 'x' ? [t, b, a] : options.facing === 'y' ? [a, t, b] : [a, b, t];
  return box({ ...options, size });
}

function placementOf(options: { at?: Vec3; rotation?: Vec3; mirror?: boolean }): Pick<Primitive, 'at' | 'rotation' | 'mirror'> {
  return {
    ...(options.at ? { at: options.at } : {}),
    ...(options.rotation ? { rotation: options.rotation } : {}),
    ...(options.mirror ? { mirror: true } : {}),
  };
}
