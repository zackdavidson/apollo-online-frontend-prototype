import type { PaletteRole } from './palette';
import type { Vec3 } from './vector';

/**
 * Triangle soup with one palette role per triangle; nine floats per triangle
 * in `positions` and `normals`. Flat normals give the low-poly look.
 */
export interface SurfaceMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly roles: readonly PaletteRole[];
  /**
   * Per-vertex engine-plume data, four floats per vertex: the plume's full
   * extent vector (xyz) and how far along it this vertex sits (w, 0 at the
   * nozzle to 1 at the tip). Zero for everything that is not a plume. The
   * renderer stretches plumes along this vector with throttle.
   */
  readonly plume: Float32Array;
}

/** Plume data for one triangle: a shared extent vector and a t per corner. */
export interface PlumeTriangle {
  readonly vector: Vec3;
  readonly t: readonly [number, number, number];
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

const DEGENERATE_AREA = 1e-10;

/** Accumulates triangles; degenerate ones (zero area) are dropped. */
export class SurfaceMeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly roles: PaletteRole[] = [];
  private readonly plume: number[] = [];

  addTriangle(a: Vec3, b: Vec3, c: Vec3, role: PaletteRole, plume?: PlumeTriangle): void {
    const normal = faceNormal(a, b, c);
    if (!normal) return;
    this.positions.push(...a, ...b, ...c);
    this.normals.push(...normal, ...normal, ...normal);
    this.roles.push(role);
    if (plume) {
      const [vx, vy, vz] = plume.vector;
      for (const t of plume.t) this.plume.push(vx, vy, vz, t);
    } else {
      this.plume.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  }

  get triangleCount(): number {
    return this.roles.length;
  }

  build(): SurfaceMesh {
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      roles: this.roles,
      plume: Float32Array.from(this.plume),
    };
  }
}

/** Unit normal of triangle abc, or null when it has no area. */
export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length < DEGENERATE_AREA) return null;
  return [nx / length, ny / length, nz / length];
}

export function emptySurfaceMesh(): SurfaceMesh {
  return { positions: new Float32Array(0), normals: new Float32Array(0), roles: [], plume: new Float32Array(0) };
}

/** Split a mesh into the triangles whose role matches and the rest. */
export function partitionSurfaceMesh(
  mesh: SurfaceMesh,
  predicate: (role: PaletteRole) => boolean,
): { matching: SurfaceMesh; rest: SurfaceMesh } {
  const matchingIndices: number[] = [];
  const restIndices: number[] = [];
  mesh.roles.forEach((role, i) => (predicate(role) ? matchingIndices : restIndices).push(i));
  return { matching: pick(mesh, matchingIndices), rest: pick(mesh, restIndices) };
}

function pick(mesh: SurfaceMesh, indices: readonly number[]): SurfaceMesh {
  const positions = new Float32Array(indices.length * 9);
  const normals = new Float32Array(indices.length * 9);
  const plume = new Float32Array(indices.length * 12);
  const roles: PaletteRole[] = [];
  indices.forEach((triangle, i) => {
    positions.set(mesh.positions.subarray(triangle * 9, triangle * 9 + 9), i * 9);
    normals.set(mesh.normals.subarray(triangle * 9, triangle * 9 + 9), i * 9);
    plume.set(mesh.plume.subarray(triangle * 12, triangle * 12 + 12), i * 12);
    roles.push(mesh.roles[triangle]!);
  });
  return { positions, normals, roles, plume };
}

export function meshBounds(mesh: SurfaceMesh): Bounds {
  if (mesh.positions.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[i + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] };
}

/** True when the boxes overlap by more than `tolerance` on every axis. */
export function boundsOverlap(a: Bounds, b: Bounds, tolerance = 0): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const overlap = Math.min(a.max[axis]!, b.max[axis]!) - Math.max(a.min[axis]!, b.min[axis]!);
    if (overlap <= tolerance) return false;
  }
  return true;
}

export function boundsContain(bounds: Bounds, point: Vec3, margin = 0): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (point[axis]! < bounds.min[axis]! - margin || point[axis]! > bounds.max[axis]! + margin) return false;
  }
  return true;
}
