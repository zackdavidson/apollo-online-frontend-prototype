import { SurfaceMeshBuilder } from './mesh';
import type { PaletteRole } from './palette';
import { IDENTITY, MIRROR_X, apply, compose, handedness, placement, type Affine } from './transform';
import { scale, type Vec3 } from './vector';

/**
 * Low-poly primitives and their tessellation. Everything a hull or attachment
 * is made of is one of these, authored in the part's local frame with +Z
 * pointing forward (hulls) or away from the mount (attachments).
 */

/** Cross-section outline used by segments. */
export type SectionShape = 'box' | 'chamfered' | 'hexagon' | 'round';

/** A rectangle-ish cross-section; `x`/`y` offset its centre. Zero width and height makes a point. */
export interface Section {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
}

interface Placed {
  /** Translation applied after `rotation`. */
  readonly at?: Vec3;
  /** Euler degrees about X, then Y, then Z. */
  readonly rotation?: Vec3;
  /** Also emit a copy reflected across X = 0. */
  readonly mirror?: boolean;
}

/**
 * A straight sweep from one cross-section at `z[0]` to another at `z[1]`.
 * Same sections give a box or cylinder; different ones give wedges, cones
 * and tapered fuselage sections.
 */
export interface SegmentPrimitive extends Placed {
  readonly kind: 'segment';
  readonly shape: SectionShape;
  /** Corner cut for 'chamfered' sections; defaults to a quarter of the smaller side. */
  readonly chamfer?: number;
  readonly from: Section;
  readonly to: Section;
  readonly z: readonly [number, number];
  readonly role: PaletteRole;
  /** Whether to close the start and end faces. Defaults to both. */
  readonly caps?: readonly [boolean, boolean];
}

/**
 * A thin plate with a convex polygon outline in the XZ plane, extruded along
 * Y. Thickness may taper from the innermost to the outermost |x|.
 */
export interface WingPrimitive extends Placed {
  readonly kind: 'wing';
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly thickness: number | readonly [root: number, tip: number];
  readonly role: PaletteRole;
}

export type Primitive = SegmentPrimitive | WingPrimitive;

/** Tessellate primitives into `builder`, placing them with `partTransform`. */
export function tessellatePrimitives(
  primitives: readonly Primitive[],
  builder: SurfaceMeshBuilder,
  partTransform: Affine = IDENTITY,
): void {
  for (const primitive of primitives) {
    const local = placement(primitive.at, primitive.rotation);
    emit(primitive, builder, compose(partTransform, local));
    if (primitive.mirror) emit(primitive, builder, compose(partTransform, compose(MIRROR_X, local)));
  }
}

function emit(primitive: Primitive, builder: SurfaceMeshBuilder, transform: Affine): void {
  const flip = handedness(transform) < 0;
  // Plume segments stretch along their local +Z; record that axis in the final frame.
  const plumeVector: Vec3 | null =
    primitive.kind === 'segment' && primitive.role === 'plume'
      ? scale(direction(transform, [0, 0, 1]), primitive.z[1] - primitive.z[0])
      : null;

  const tri = (a: Vec3, b: Vec3, c: Vec3, role: PaletteRole, t?: readonly [number, number, number]): void => {
    const [ta, tb, tc] = [apply(transform, a), apply(transform, b), apply(transform, c)];
    const plume = plumeVector && t ? { vector: plumeVector, t } : undefined;
    if (flip) {
      const swapped = plume ? { vector: plume.vector, t: [plume.t[0], plume.t[2], plume.t[1]] as const } : undefined;
      builder.addTriangle(ta, tc, tb, role, swapped);
    } else {
      builder.addTriangle(ta, tb, tc, role, plume);
    }
  };
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, role: PaletteRole, t?: readonly [number, number, number, number]): void => {
    tri(a, b, c, role, t ? [t[0], t[1], t[2]] : undefined);
    tri(a, c, d, role, t ? [t[0], t[2], t[3]] : undefined);
  };
  if (primitive.kind === 'segment') tessellateSegment(primitive, tri, quad);
  else tessellateWing(primitive, tri, quad);
}

/** The image of a direction under the linear part of a transform. */
function direction(transform: Affine, v: Vec3): Vec3 {
  const origin = apply(transform, [0, 0, 0]);
  const moved = apply(transform, v);
  return [moved[0] - origin[0], moved[1] - origin[1], moved[2] - origin[2]];
}

type TriangleSink = (a: Vec3, b: Vec3, c: Vec3, role: PaletteRole, t?: readonly [number, number, number]) => void;
type QuadSink = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, role: PaletteRole, t?: readonly [number, number, number, number]) => void;

/** Outline points of a section, counter-clockwise in the XY plane seen from +Z. */
export function sectionOutline(shape: SectionShape, section: Section, chamfer?: number): Array<readonly [number, number]> {
  const w = section.width;
  const h = section.height;
  const cx = section.x ?? 0;
  const cy = section.y ?? 0;
  const hw = w / 2;
  const hh = h / 2;
  const shift = (points: Array<readonly [number, number]>): Array<readonly [number, number]> =>
    points.map(([x, y]) => [x + cx, y + cy]);

  switch (shape) {
    case 'box':
      return shift([
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ]);
    case 'chamfered': {
      const c = Math.min(chamfer ?? Math.min(w, h) * 0.25, Math.min(hw, hh));
      return shift([
        [-hw + c, -hh],
        [hw - c, -hh],
        [hw, -hh + c],
        [hw, hh - c],
        [hw - c, hh],
        [-hw + c, hh],
        [-hw, hh - c],
        [-hw, -hh + c],
      ]);
    }
    case 'hexagon':
      return shift([
        [-hw / 2, -hh],
        [hw / 2, -hh],
        [hw, 0],
        [hw / 2, hh],
        [-hw / 2, hh],
        [-hw, 0],
      ]);
    case 'round': {
      const sides = 12;
      const points: Array<readonly [number, number]> = [];
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2 + Math.PI / sides;
        points.push([hw * Math.cos(angle), hh * Math.sin(angle)]);
      }
      return shift(points);
    }
  }
}

function isPoint(section: Section): boolean {
  return section.width <= 0 && section.height <= 0;
}

function tessellateSegment(segment: SegmentPrimitive, tri: TriangleSink, quad: QuadSink): void {
  let [z0, z1] = segment.z;
  let [from, to] = [segment.from, segment.to];
  let [capStart, capEnd] = segment.caps ?? [true, true];
  if (z1 < z0) {
    [z0, z1] = [z1, z0];
    [from, to] = [to, from];
    [capStart, capEnd] = [capEnd, capStart];
  }
  const ringA = sectionOutline(segment.shape, from, segment.chamfer);
  const ringB = sectionOutline(segment.shape, to, segment.chamfer);
  const n = ringA.length;
  const A = (i: number): Vec3 => [ringA[i % n]![0], ringA[i % n]![1], z0];
  const B = (i: number): Vec3 => [ringB[i % n]![0], ringB[i % n]![1], z1];
  // Fraction along the authored z range (0 at z[0], 1 at z[1]); only plumes use it.
  const [zBase, zTip] = segment.z;
  const tOf = (z: number): number => (zTip === zBase ? 0 : (z - zBase) / (zTip - zBase));
  const tA = tOf(z0);
  const tB = tOf(z1);

  for (let i = 0; i < n; i++) quad(A(i), A(i + 1), B(i + 1), B(i), segment.role, [tA, tA, tB, tB]);

  if (capEnd && !isPoint(to)) {
    const centre: Vec3 = [to.x ?? 0, to.y ?? 0, z1];
    for (let i = 0; i < n; i++) tri(centre, B(i), B(i + 1), segment.role, [tB, tB, tB]);
  }
  if (capStart && !isPoint(from)) {
    const centre: Vec3 = [from.x ?? 0, from.y ?? 0, z0];
    for (let i = 0; i < n; i++) tri(centre, A(i + 1), A(i), segment.role, [tA, tA, tA]);
  }
}

function tessellateWing(wing: WingPrimitive, tri: TriangleSink, quad: QuadSink): void {
  // Orient the outline clockwise in (x, z) so the fan on the top face points +Y.
  let points = [...wing.points];
  let signedArea = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, z0] = points[i]!;
    const [x1, z1] = points[(i + 1) % points.length]!;
    signedArea += x0 * z1 - x1 * z0;
  }
  if (signedArea > 0) points = points.reverse();

  const spans = points.map(([x]) => Math.abs(x));
  const inner = Math.min(...spans);
  const outer = Math.max(...spans);
  const thicknessAt = (x: number): number => {
    if (typeof wing.thickness === 'number') return wing.thickness;
    const t = outer === inner ? 0 : (Math.abs(x) - inner) / (outer - inner);
    return wing.thickness[0] + (wing.thickness[1] - wing.thickness[0]) * t;
  };
  const top = points.map(([x, z]): Vec3 => [x, thicknessAt(x) / 2, z]);
  const bottom = points.map(([x, z]): Vec3 => [x, -thicknessAt(x) / 2, z]);
  const n = points.length;

  for (let i = 1; i < n - 1; i++) {
    tri(top[0]!, top[i]!, top[i + 1]!, wing.role);
    tri(bottom[0]!, bottom[i + 1]!, bottom[i]!, wing.role);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    quad(top[i]!, bottom[i]!, bottom[j]!, top[j]!, wing.role);
  }
}
