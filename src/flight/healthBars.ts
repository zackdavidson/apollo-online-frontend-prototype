import { Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';

export interface BarEntry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  /** 0..1 filled fraction. */
  readonly fraction: number;
  readonly colour: string;
}

/**
 * Many small health bars as two instanced quads (dark track and coloured
 * fill), billboarded to the camera and drawn on top of the scene.
 */
export class InstancedBars {
  readonly group = new Group();
  private readonly track: InstancedMesh;
  private readonly fill: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly offset = new Vector3();
  private readonly scale = new Vector3();
  private readonly colour = new Color();

  constructor(private readonly max: number) {
    const geometry = new PlaneGeometry(1, 1);
    this.track = new InstancedMesh(
      geometry,
      new MeshBasicMaterial({ color: 0x2a3040, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }),
      max,
    );
    this.fill = new InstancedMesh(
      geometry,
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
      max,
    );
    this.track.renderOrder = 30;
    this.fill.renderOrder = 31;
    for (const mesh of [this.track, this.fill]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  sync(entries: readonly BarEntry[], facing: Quaternion): void {
    const count = Math.min(entries.length, this.max);
    for (let i = 0; i < count; i++) {
      const bar = entries[i]!;
      this.position.set(bar.x, bar.y, bar.z);
      this.scale.set(bar.width, bar.height, 1);
      this.matrix.compose(this.position, facing, this.scale);
      this.track.setMatrixAt(i, this.matrix);

      const fraction = Math.max(0, Math.min(1, bar.fraction));
      const inner = bar.width * 0.92;
      // Left-align the fill inside the track, nudged towards the camera.
      this.offset.set((-inner * (1 - fraction)) / 2, 0, 0.02).applyQuaternion(facing);
      this.position.add(this.offset);
      this.scale.set(Math.max(0.001, inner * fraction), bar.height * 0.55, 1);
      this.matrix.compose(this.position, facing, this.scale);
      this.fill.setMatrixAt(i, this.matrix);
      this.fill.setColorAt(i, this.colour.set(bar.colour));
    }
    for (const mesh of [this.track, this.fill]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.track.geometry.dispose();
    (this.track.material as MeshBasicMaterial).dispose();
    (this.fill.material as MeshBasicMaterial).dispose();
  }
}
