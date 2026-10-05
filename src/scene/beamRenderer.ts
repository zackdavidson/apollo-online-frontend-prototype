import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial } from 'three';
import type { BeamStyle } from '../game/weapons';

export interface BeamVisual {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly y: number;
  readonly width: number;
  readonly colour: string;
  /** 1 when just fired, falling to 0 as the beam fades. */
  readonly fade: number;
  readonly style: BeamStyle;
  readonly seed: number;
}

const MAX_VERTICES = 6144;
const SEGMENTS: Readonly<Record<BeamStyle, number>> = { lance: 8, siege: 10, arc: 16 };

/**
 * Draws beams as flat glowing ribbons on the ship plane: a wide soft outer
 * pass and a hot core. Lances pulse, siege beams are thick and heavy, arcs
 * jitter into jagged lightning that re-rolls many times a second.
 */
export class BeamRenderer {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly positions = new Float32Array(MAX_VERTICES * 3);
  private readonly colours = new Float32Array(MAX_VERTICES * 3);
  private vertexCount = 0;
  private readonly colour = new Color();
  private readonly white = new Color('#ffffff');

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colours, 3));
    geometry.setDrawRange(0, 0);
    this.mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    this.mesh.frustumCulled = false;
  }

  sync(beams: readonly BeamVisual[], time: number): void {
    this.vertexCount = 0;
    for (const beam of beams) {
      this.ribbon(beam, time, 2.8, 0.28);
      this.ribbon(beam, time, 1.0, 1.0);
    }
    const geometry = this.mesh.geometry;
    geometry.setDrawRange(0, this.vertexCount);
    (geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private ribbon(beam: BeamVisual, time: number, widthScale: number, intensity: number): void {
    const dx = beam.x1 - beam.x0;
    const dz = beam.z1 - beam.z0;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) return;
    const ux = dx / length;
    const uz = dz / length;
    const nx = -uz;
    const nz = ux;
    const segments = SEGMENTS[beam.style];
    const frame = Math.floor(time * 40);
    const core = intensity >= 1;
    this.colour.set(beam.colour);
    if (core) this.colour.lerp(this.white, beam.style === 'siege' ? 0.55 : 0.65);
    const r = this.colour.r * intensity * beam.fade;
    const g = this.colour.g * intensity * beam.fade;
    const b = this.colour.b * intensity * beam.fade;

    let prevL: [number, number] | null = null;
    let prevR: [number, number] | null = null;
    for (let k = 0; k <= segments; k++) {
      const t = k / segments;
      let offset = 0;
      let widthFactor = 1;
      if (beam.style === 'arc') {
        offset = (hash(beam.seed, k, frame) - 0.5) * beam.width * 5 * Math.sin(Math.PI * t);
        widthFactor = 0.6 + 0.6 * hash(beam.seed + 7, k, frame);
      } else if (beam.style === 'lance') {
        widthFactor = (1 - 0.35 * t) * (0.85 + 0.15 * Math.sin(time * 50 + t * 18));
      } else {
        widthFactor = 1 + 0.12 * Math.sin(time * 30 - t * 28);
      }
      const half = (beam.width * widthScale * widthFactor) / 2;
      const cx = beam.x0 + ux * length * t + nx * offset;
      const cz = beam.z0 + uz * length * t + nz * offset;
      const left: [number, number] = [cx + nx * half, cz + nz * half];
      const right: [number, number] = [cx - nx * half, cz - nz * half];
      if (prevL && prevR) {
        this.triangle(prevL, prevR, right, beam.y, r, g, b);
        this.triangle(prevL, right, left, beam.y, r, g, b);
      }
      prevL = left;
      prevR = right;
    }
  }

  private triangle(a: [number, number], b: [number, number], c: [number, number], y: number, r: number, g: number, bl: number): void {
    if (this.vertexCount + 3 > MAX_VERTICES) return;
    for (const [x, z] of [a, b, c]) {
      const i = this.vertexCount * 3;
      this.positions[i] = x;
      this.positions[i + 1] = y;
      this.positions[i + 2] = z;
      this.colours[i] = r;
      this.colours[i + 1] = g;
      this.colours[i + 2] = bl;
      this.vertexCount++;
    }
  }
}

/** Cheap deterministic noise in [0, 1). */
function hash(a: number, b: number, c: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return v - Math.floor(v);
}
