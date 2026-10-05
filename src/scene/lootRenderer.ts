import { AdditiveBlending, Color, InstancedMesh, Matrix4, MeshBasicMaterial, OctahedronGeometry, Quaternion, Vector3 } from 'three';
import { RESOURCES, type Pickup } from '../game/loot';

const MAX_PICKUPS = 400;

/** Resource pickups as bobbing, spinning glowing octahedra, coloured per resource. */
export class LootRenderer {
  readonly mesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly colour = new Color();
  private readonly yAxis = new Vector3(0, 1, 0);

  constructor() {
    this.mesh = new InstancedMesh(
      new OctahedronGeometry(0.5, 0),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }),
      MAX_PICKUPS,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  sync(pickups: readonly Pickup[], time: number): void {
    const count = Math.min(pickups.length, MAX_PICKUPS);
    for (let i = 0; i < count; i++) {
      const p = pickups[i]!;
      const bob = 0.5 + Math.sin(time * 3 + p.phase) * 0.2;
      this.position.set(p.x, bob, p.z);
      this.quaternion.setFromAxisAngle(this.yAxis, time * 2 + p.phase);
      const fade = Math.min(1, p.life / 3);
      const size = p.kind === 'crystal' ? 1.3 : 1;
      this.scale.set(size, size * 1.4, size);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, this.colour.set(RESOURCES[p.kind].colour).multiplyScalar(0.6 + 0.4 * fade));
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
