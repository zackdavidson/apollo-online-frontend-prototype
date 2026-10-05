import {
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { emptySurfaceMesh, partitionSurfaceMesh, type SurfaceMesh } from '../core/mesh';
import { EMISSIVE_ROLES, colourForRole, type PaletteRole, type ShipColours } from '../core/palette';
import { createGlowMaterial, type GlowUniforms } from './glowMaterial';
import { buildGeometry, repaintGeometry } from './meshData';

/** Crease angle in degrees above which the optional outline draws an edge. */
const OUTLINE_THRESHOLD_DEGREES = 22;

/**
 * Renderable ship: one lit mesh for hull materials, one unlit translucent
 * mesh for glow (engine plumes, lights), and an optional crease outline. Two draw
 * calls per ship regardless of part count, which keeps a crowded battle
 * cheap. Rebuilding the shape and repainting the colours are separate so
 * colour tweaks never re-tessellate.
 */
export class ShipMesh extends Group {
  private litData: SurfaceMesh = emptySurfaceMesh();
  private glowData: SurfaceMesh = emptySurfaceMesh();
  private readonly litMesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  private readonly glowMesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly outline: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly glowUniforms: GlowUniforms;
  private colours: ShipColours;

  constructor(colours: ShipColours) {
    super();
    this.colours = colours;
    this.litMesh = new Mesh(
      new BufferGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2, side: DoubleSide }),
    );
    const glow = createGlowMaterial();
    this.glowUniforms = glow.uniforms;
    this.glowMesh = new Mesh(new BufferGeometry(), glow.material);
    this.outline = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
    );
    this.outline.visible = false;
    this.add(this.litMesh, this.glowMesh, this.outline);
  }

  setSurface(surface: SurfaceMesh): void {
    const { matching, rest } = partitionSurfaceMesh(surface, (role) => EMISSIVE_ROLES.has(role));
    this.glowData = matching;
    this.litData = rest;

    const colourOf = this.resolver();
    this.replaceGeometry(this.litMesh, buildGeometry(this.litData, colourOf));
    this.replaceGeometry(this.glowMesh, buildGeometry(this.glowData, colourOf));
    this.outline.geometry.dispose();
    this.outline.geometry = new EdgesGeometry(this.litMesh.geometry, OUTLINE_THRESHOLD_DEGREES);
  }

  setColours(colours: ShipColours): void {
    this.colours = colours;
    const colourOf = this.resolver();
    repaintGeometry(this.litMesh.geometry, this.litData, colourOf);
    repaintGeometry(this.glowMesh.geometry, this.glowData, colourOf);
  }

  setOutlineVisible(visible: boolean): void {
    this.outline.visible = visible;
  }

  /** Drive the engine plumes: 0 idle, 1 full thrust, above 1 for boost. */
  setThrottle(throttle: number): void {
    this.glowUniforms.uThrottle.value = throttle;
  }

  /** Advance the plume flicker; call once per frame with elapsed seconds. */
  update(timeSeconds: number): void {
    this.glowUniforms.uTime.value = timeSeconds;
  }

  /** Triangles currently on the GPU for this ship, for the stats readout. */
  get triangleCount(): number {
    return this.litData.roles.length + this.glowData.roles.length;
  }

  override dispose(): void {
    this.litMesh.geometry.dispose();
    this.litMesh.material.dispose();
    this.glowMesh.geometry.dispose();
    this.glowMesh.material.dispose();
    this.outline.geometry.dispose();
    this.outline.material.dispose();
  }

  private resolver(): (role: PaletteRole) => string {
    return (role) => colourForRole(role, this.colours);
  }

  private replaceGeometry(mesh: Mesh<BufferGeometry>, geometry: BufferGeometry): void {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }
}
