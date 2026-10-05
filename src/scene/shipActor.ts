import { BackSide, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { partitionSurfaceMesh, type SurfaceMesh } from '../core/mesh';
import { EMISSIVE_ROLES, type ShipColours } from '../core/palette';
import { ShipMesh } from '../render/shipMesh';
import { ShieldShell } from './shieldShell';

export interface ShipVisualSpec {
  readonly surface: SurfaceMesh;
  readonly colours: ShipColours;
  /** Outline and label colour. */
  readonly accent: string;
  /** Hit radius; sizes the shield shell. */
  readonly radius: number;
}

const SHIELD_COLOUR = '#5fb4ff';

/** One ship in the arena: hull mesh, shield shell and a hover outline. Pure visuals. */
export class ShipActor {
  readonly group = new Group();
  readonly mesh: ShipMesh;
  readonly shell: ShieldShell;
  private readonly outline: Mesh<BufferGeometry, MeshBasicMaterial>;
  private shieldFraction = 1;

  constructor(readonly spec: ShipVisualSpec) {
    this.mesh = new ShipMesh(spec.colours);
    this.mesh.setSurface(spec.surface);
    this.shell = new ShieldShell(spec.radius, SHIELD_COLOUR);
    // Inverted hull of the lit surface, slightly enlarged, shown while hovered.
    const lit = partitionSurfaceMesh(spec.surface, (role) => EMISSIVE_ROLES.has(role)).rest;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(lit.positions, 3));
    this.outline = new Mesh(geometry, new MeshBasicMaterial({ color: spec.accent, side: BackSide, transparent: true, opacity: 0.9 }));
    this.outline.scale.setScalar(1.08);
    this.outline.visible = false;
    this.group.add(this.mesh, this.shell, this.outline);
  }

  setOutlined(outlined: boolean): void {
    this.outline.visible = outlined;
  }

  place(x: number, z: number, heading: number, jitter = 0): void {
    this.group.position.set(x + (Math.random() - 0.5) * jitter, 0, z + (Math.random() - 0.5) * jitter);
    this.group.rotation.y = heading;
  }

  setShield(fraction: number): void {
    this.shieldFraction = fraction;
  }

  /** Ripple the shield from the world point the hit came from. */
  shieldHit(atX: number, atZ: number): void {
    const dx = atX - this.group.position.x;
    const dz = atZ - this.group.position.z;
    const h = this.group.rotation.y;
    this.shell.hit(dx * Math.cos(h) - dz * Math.sin(h), dx * Math.sin(h) + dz * Math.cos(h));
  }

  update(dt: number, time: number): void {
    this.mesh.update(time);
    this.shell.update(dt, this.shieldFraction, time);
  }

  dispose(): void {
    this.mesh.dispose();
    this.shell.dispose();
    this.outline.geometry.dispose();
    this.outline.material.dispose();
  }
}
