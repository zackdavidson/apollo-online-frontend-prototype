import { describe, expect, it } from 'vitest';
import { sectionOutline, tessellatePrimitives, type Primitive } from './geometry';
import { SurfaceMeshBuilder, meshBounds, type SurfaceMesh } from './mesh';
import { box, cone, plate, taper, tube, wing } from './primitives';

function mesh(primitives: Primitive[]): SurfaceMesh {
  const builder = new SurfaceMeshBuilder();
  tessellatePrimitives(primitives, builder);
  return builder.build();
}

function triangles(m: SurfaceMesh): Array<[number[], number[], number[]]> {
  const out: Array<[number[], number[], number[]]> = [];
  for (let t = 0; t < m.roles.length; t++) {
    const o = t * 9;
    const p = Array.from(m.positions.subarray(o, o + 9));
    out.push([p.slice(0, 3), p.slice(3, 6), p.slice(6, 9)]);
  }
  return out;
}

/** Every triangle's stored normal should point away from `centre`. */
function expectOutward(m: SurfaceMesh, centre: number[]): void {
  triangles(m).forEach(([a, b, c], t) => {
    const centroid = [0, 1, 2].map((i) => (a[i]! + b[i]! + c[i]!) / 3);
    const n = [m.normals[t * 9]!, m.normals[t * 9 + 1]!, m.normals[t * 9 + 2]!];
    const dot = n.reduce((sum, v, i) => sum + v * (centroid[i]! - centre[i]!), 0);
    expect(dot, `triangle ${t} faces inward`).toBeGreaterThan(0);
  });
}

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 5));
}

describe('section outlines', () => {
  it('produces the expected vertex counts', () => {
    expect(sectionOutline('box', { width: 2, height: 1 })).toHaveLength(4);
    expect(sectionOutline('chamfered', { width: 2, height: 1 })).toHaveLength(8);
    expect(sectionOutline('hexagon', { width: 2, height: 1 })).toHaveLength(6);
    expect(sectionOutline('round', { width: 2, height: 1 })).toHaveLength(12);
  });

  it('winds counter-clockwise seen from +Z', () => {
    for (const shape of ['box', 'chamfered', 'hexagon', 'round'] as const) {
      const points = sectionOutline(shape, { width: 2, height: 1.5 });
      let area = 0;
      points.forEach(([x0, y0], i) => {
        const [x1, y1] = points[(i + 1) % points.length]!;
        area += x0 * y1 - x1 * y0;
      });
      expect(area, shape).toBeGreaterThan(0);
    }
  });
});

describe('segments', () => {
  it('a box is 16 outward-facing triangles (8 sides, 4 per fanned cap) with the right bounds', () => {
    const m = mesh([box({ size: [2, 1, 4], role: 'main' })]);
    expect(m.roles).toHaveLength(16);
    expectOutward(m, [0, 0, 0]);
    const bounds = meshBounds(m);
    expectClose(bounds.min, [-1, -0.5, -2]);
    expectClose(bounds.max, [1, 0.5, 2]);
  });

  it('a cone has no end cap and still faces outward', () => {
    const m = mesh([cone({ radius: 1, z: [0, 3], role: 'dark' })]);
    // 12 side triangles + 12 base cap triangles.
    expect(m.roles).toHaveLength(24);
    expectOutward(m, [0, 0, 1]);
  });

  it('a reversed z range still produces an outward mesh', () => {
    const forward = mesh([tube({ radius: 0.5, z: [0, 2], role: 'main' })]);
    const reversed = mesh([tube({ radius: 0.5, z: [2, 0], role: 'main' })]);
    expect(reversed.roles).toHaveLength(forward.roles.length);
    expectOutward(reversed, [0, 0, 1]);
  });

  it('a tube on the x axis extends along x', () => {
    const bounds = meshBounds(mesh([tube({ radius: 0.5, z: [0, 4], axis: 'x', role: 'metal' })]));
    expect(bounds.max[0]).toBeCloseTo(4, 5);
    expect(bounds.max[2]).toBeLessThan(0.6);
  });

  it('taper changes the cross-section between its ends', () => {
    const m = mesh([taper({ shape: 'box', from: { width: 4, height: 4 }, to: { width: 1, height: 1 }, z: [0, 5], role: 'main' })]);
    const atFar = triangles(m).flat().filter((p) => Math.abs(p[2]! - 5) < 1e-6);
    expect(Math.max(...atFar.map((p) => Math.abs(p[0]!)))).toBeCloseTo(0.5, 5);
    expectOutward(m, [0, 0, 1.5]);
  });

  it('plates orient their thin side along the facing axis', () => {
    const x = meshBounds(mesh([plate({ size: [3, 1], facing: 'x', role: 'trim' })]));
    expect(x.max[0]! - x.min[0]!).toBeCloseTo(0.06, 5);
    expect(x.max[2]! - x.min[2]!).toBeCloseTo(3, 5);
    const y = meshBounds(mesh([plate({ size: [3, 1], facing: 'y', role: 'trim' })]));
    expect(y.max[1]! - y.min[1]!).toBeCloseTo(0.06, 5);
  });
});

describe('wings', () => {
  const planform: Array<[number, number]> = [
    [1, 2],
    [1, -2],
    [5, -3],
    [5, -2],
  ];

  it('is closed and outward facing regardless of point order', () => {
    const a = mesh([wing({ points: planform, thickness: 0.3, role: 'main' })]);
    const b = mesh([wing({ points: [...planform].reverse(), thickness: 0.3, role: 'main' })]);
    expect(a.roles).toHaveLength(2 * 2 + 4 * 2);
    expectOutward(a, [3, 0, -1.2]);
    expectOutward(b, [3, 0, -1.2]);
  });

  it('tapers thickness towards the tip', () => {
    const m = mesh([wing({ points: planform, thickness: [0.4, 0.1], role: 'main' })]);
    const ys = (x: number): number[] => triangles(m).flat().filter((p) => Math.abs(p[0]! - x) < 1e-6).map((p) => p[1]!);
    expect(Math.max(...ys(1))).toBeCloseTo(0.2, 5);
    expect(Math.max(...ys(5))).toBeCloseTo(0.05, 5);
  });
});

describe('placement and mirroring', () => {
  it('mirror emits a symmetric copy that still faces outward', () => {
    const single = mesh([box({ size: [1, 1, 1], at: [2, 0, 0], role: 'main' })]);
    const mirrored = mesh([box({ size: [1, 1, 1], at: [2, 0, 0], role: 'main', mirror: true })]);
    expect(mirrored.roles).toHaveLength(single.roles.length * 2);
    const bounds = meshBounds(mirrored);
    expectClose(bounds.min, [-2.5, -0.5, -0.5]);
    expectClose(bounds.max, [2.5, 0.5, 0.5]);
    // Check the mirrored half on its own faces outward from its own centre.
    const left = triangles(mirrored).map((tri, t) => ({ tri, t })).filter(({ tri }) => tri[0][0]! < 0);
    for (const { tri: [a, b, c], t } of left) {
      const centroid = [0, 1, 2].map((i) => (a[i]! + b[i]! + c[i]!) / 3);
      const n = [mirrored.normals[t * 9]!, mirrored.normals[t * 9 + 1]!, mirrored.normals[t * 9 + 2]!];
      const dot = n[0]! * (centroid[0]! + 2) + n[1]! * centroid[1]! + n[2]! * centroid[2]!;
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('rotation is applied before translation', () => {
    const bounds = meshBounds(mesh([box({ size: [4, 0.2, 0.2], at: [0, 5, 0], rotation: [0, 0, 90], role: 'main' })]));
    expect(bounds.max[1]! - bounds.min[1]!).toBeCloseTo(4, 5);
    expect((bounds.max[1]! + bounds.min[1]!) / 2).toBeCloseTo(5, 5);
  });
});

describe('plume data', () => {
  it('records the plume axis and fraction only for plume segments', () => {
    const m = mesh([cone({ radius: 0.4, z: [1, 4], role: 'plume' }), box({ size: [1, 1, 1], role: 'main' })]);
    const perVertexT: number[] = [];
    const vectors = new Set<string>();
    m.roles.forEach((role, t) => {
      for (let corner = 0; corner < 3; corner++) {
        const o = (t * 3 + corner) * 4;
        const [vx, vy, vz, w] = [m.plume[o]!, m.plume[o + 1]!, m.plume[o + 2]!, m.plume[o + 3]!];
        if (role === 'plume') {
          perVertexT.push(w);
          vectors.add(`${vx.toFixed(3)},${vy.toFixed(3)},${vz.toFixed(3)}`);
        } else {
          expect([vx, vy, vz, w]).toEqual([0, 0, 0, 0]);
        }
      }
    });
    expect(Math.min(...perVertexT)).toBeCloseTo(0, 6);
    expect(Math.max(...perVertexT)).toBeCloseTo(1, 6);
    // The extent vector is the authored z range (3 long) along +Z.
    expect(vectors).toEqual(new Set(['0.000,0.000,3.000']));
  });
});
