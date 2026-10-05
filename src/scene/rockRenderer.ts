import {
  AdditiveBlending,
  BackSide,
  Color,
  DodecahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { ROCK_KINDS, type Rock } from '../game/rocks';

const MAX_ROCKS = 1400;
const MAX_GEMS = 900;
const GEMS_PER_CRYSTAL = 3;
const OUTLINE_SCALE = 1.14;

const yAxis = new Vector3(0, 1, 0);
const xAxis = new Vector3(1, 0, 0);
const tilt = new Quaternion();

/** The visual transform of a rock, shared by the renderer, the outline and the health bars. */
export function rockTransform(rock: Rock, position: Vector3, quaternion: Quaternion, scale: Vector3): void {
  position.set(rock.x, (rock.seed - 0.5) * 0.8, rock.z);
  quaternion.setFromAxisAngle(yAxis, rock.rotation);
  tilt.setFromAxisAngle(xAxis, rock.seed * Math.PI);
  quaternion.multiply(tilt);
  const squash = rock.kind === 'ice' ? 0.55 + rock.seed * 0.3 : 0.7 + rock.seed * 0.4;
  scale.set(rock.radius, rock.radius * squash, rock.radius * (0.85 + rock.seed * 0.3));
}

/** Height of a rock's top above the plane, for placing things above it. */
export function rockTop(rock: Rock): number {
  const squash = rock.kind === 'ice' ? 0.55 + rock.seed * 0.3 : 0.7 + rock.seed * 0.4;
  return (rock.seed - 0.5) * 0.8 + rock.radius * squash;
}

/**
 * Draws every rock as one instanced mesh, coloured by kind, plus a second
 * additive mesh of glowing gem nodes riding on crystal rocks, and a single
 * inverted-hull outline for whichever rock is hovered.
 */
export class RockRenderer {
  readonly mesh: InstancedMesh;
  readonly gems: InstancedMesh;
  readonly outline: Mesh<DodecahedronGeometry, MeshBasicMaterial>;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly colour = new Color();

  constructor() {
    const geometry = new DodecahedronGeometry(1, 0);
    this.mesh = new InstancedMesh(
      geometry,
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.08, flatShading: true }),
      MAX_ROCKS,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.gems = new InstancedMesh(
      new OctahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      MAX_GEMS,
    );
    this.gems.frustumCulled = false;
    this.gems.count = 0;
    this.outline = new Mesh(geometry, new MeshBasicMaterial({ color: 0xffffff, side: BackSide, transparent: true, opacity: 0.9 }));
    this.outline.visible = false;
    this.outline.frustumCulled = false;
  }

  sync(rocks: readonly Rock[], time: number, hovered: Rock | null): void {
    const count = Math.min(rocks.length, MAX_ROCKS);
    let gemCount = 0;
    for (let i = 0; i < count; i++) {
      const rock = rocks[i]!;
      const info = ROCK_KINDS[rock.kind];
      rockTransform(rock, this.position, this.quaternion, this.scale);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      this.colour.set(info.colours[Math.floor(rock.seed * info.colours.length)]!);
      if (rock.kind === 'giant') this.colour.multiplyScalar(0.9 + rock.seed * 0.2);
      this.mesh.setColorAt(i, this.colour);

      if (info.gems && gemCount + GEMS_PER_CRYSTAL <= MAX_GEMS) {
        for (let g = 0; g < GEMS_PER_CRYSTAL; g++) {
          const angle = rock.rotation + rock.seed * 7 + (g / GEMS_PER_CRYSTAL) * Math.PI * 2;
          const reach = rock.radius * 0.72;
          const pulse = 0.85 + 0.15 * Math.sin(time * 4 + rock.seed * 20 + g);
          this.position.set(rock.x + Math.cos(angle) * reach, rock.radius * 0.45, rock.z + Math.sin(angle) * reach);
          this.quaternion.setFromAxisAngle(yAxis, time * 0.8 + g);
          const size = rock.radius * 0.22 * pulse;
          this.scale.set(size, size * 1.5, size);
          this.matrix.compose(this.position, this.quaternion, this.scale);
          this.gems.setMatrixAt(gemCount, this.matrix);
          this.gems.setColorAt(gemCount, this.colour.set(info.gems).multiplyScalar(pulse));
          gemCount++;
        }
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.gems.count = gemCount;
    this.gems.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;

    if (hovered) {
      rockTransform(hovered, this.outline.position, this.outline.quaternion, this.outline.scale);
      this.outline.scale.multiplyScalar(OUTLINE_SCALE);
      this.outline.material.color.set(ROCK_KINDS[hovered.kind].gems ?? '#ffffff');
      this.outline.visible = true;
    } else {
      this.outline.visible = false;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.gems.geometry.dispose();
    (this.gems.material as MeshBasicMaterial).dispose();
    this.outline.material.dispose();
  }
}
