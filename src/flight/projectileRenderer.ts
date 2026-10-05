import { AdditiveBlending, BoxGeometry, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { MAX_PROJECTILES, type Projectile } from './projectiles';

/**
 * Draws all live projectiles with two instanced meshes: stretched boxes for
 * tracers, beams, missiles and pellets; spheres for plasma. Size and colour
 * come from each projectile's weapon profile.
 */
export class ProjectileRenderer {
  readonly group = new Group();
  private readonly boxes: InstancedMesh;
  private readonly orbs: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly colour = new Color();
  private readonly yAxis = new Vector3(0, 1, 0);

  constructor() {
    const material = (): MeshBasicMaterial =>
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false });
    this.boxes = new InstancedMesh(new BoxGeometry(1, 1, 1), material(), MAX_PROJECTILES);
    this.orbs = new InstancedMesh(new SphereGeometry(0.5, 10, 8), material(), MAX_PROJECTILES);
    for (const mesh of [this.boxes, this.orbs]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  sync(projectiles: readonly Projectile[]): void {
    let boxCount = 0;
    let orbCount = 0;
    for (const p of projectiles) {
      const mesh = p.weapon.kind === 'plasma' ? this.orbs : this.boxes;
      const index = mesh === this.orbs ? orbCount++ : boxCount++;
      this.position.set(p.x, p.y, p.z);
      this.quaternion.setFromAxisAngle(this.yAxis, Math.atan2(p.vx, p.vz));
      this.scale.set(p.weapon.size[0], p.weapon.size[1], p.weapon.size[2]);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      mesh.setColorAt(index, this.colour.set(p.weapon.colour));
    }
    this.boxes.count = boxCount;
    this.orbs.count = orbCount;
    for (const mesh of [this.boxes, this.orbs]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of [this.boxes, this.orbs]) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
  }
}
