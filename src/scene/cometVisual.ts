import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';
import type { CometState } from '../game/comet';
import type { Rng } from '../game/random';

const TRAIL_PARTICLES = 900;
const TRAIL_LIFE = 3.2;
const EMIT_PER_SECOND = 140;
const HEAD_COLOUR = '#d6ecff';
const GLOW_COLOUR = '#9fd8ff';
const OUTLINE_SCALE = 1.12;

/**
 * The comet's look: a faceted icy head with an additive glow, a long trail
 * of soft particles streaming behind it in world space, and an outline for
 * hover. Everything lives on the default (gameplay) layer.
 */
export class CometVisual extends Group {
  private readonly head: Mesh<IcosahedronGeometry, MeshStandardMaterial>;
  private readonly glow: Sprite;
  private readonly outline: Mesh<IcosahedronGeometry, MeshBasicMaterial>;
  private readonly trail: Points;
  private readonly positions = new Float32Array(TRAIL_PARTICLES * 3);
  private readonly colours = new Float32Array(TRAIL_PARTICLES * 3);
  private readonly velocities = new Float32Array(TRAIL_PARTICLES * 3);
  private readonly life = new Float32Array(TRAIL_PARTICLES);
  private trailCount = 0;
  private emitDebt = 0;

  constructor(
    private readonly rng: Rng,
    glowTexture: Texture,
  ) {
    super();
    const geometry = new IcosahedronGeometry(1, 1);
    this.head = new Mesh(
      geometry,
      new MeshStandardMaterial({ color: HEAD_COLOUR, emissive: GLOW_COLOUR, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.05, flatShading: true }),
    );
    this.glow = new Sprite(new SpriteMaterial({ map: glowTexture, color: GLOW_COLOUR, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }));
    this.outline = new Mesh(geometry, new MeshBasicMaterial({ color: '#ffffff', side: BackSide, transparent: true, opacity: 0.9 }));
    this.outline.visible = false;

    const trailGeometry = new BufferGeometry();
    trailGeometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    trailGeometry.setAttribute('color', new BufferAttribute(this.colours, 3));
    trailGeometry.setDrawRange(0, 0);
    this.trail = new Points(
      trailGeometry,
      new PointsMaterial({ map: glowTexture, size: 3.2, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
    );
    this.trail.frustumCulled = false;
    this.add(this.head, this.glow, this.outline, this.trail);
  }

  update(comet: CometState, dt: number, time: number, hovered: boolean): void {
    const visible = comet.alive;
    this.head.visible = visible;
    this.glow.visible = visible;
    this.outline.visible = visible && hovered;
    if (visible) {
      const damage = 1 - comet.hp / comet.maxHp;
      const radius = comet.radius * (1 - damage * 0.35);
      this.head.position.set(comet.x, 0.5, comet.z);
      this.head.scale.setScalar(radius);
      this.head.rotation.set(time * 0.25, time * 0.4, 0);
      this.glow.position.copy(this.head.position);
      const pulse = 1 + 0.08 * Math.sin(time * 5);
      this.glow.scale.set(radius * 5.5 * pulse, radius * 5.5 * pulse, 1);
      this.outline.position.copy(this.head.position);
      this.outline.rotation.copy(this.head.rotation);
      this.outline.scale.setScalar(radius * OUTLINE_SCALE);
      this.emit(comet, radius, dt);
    }
    this.ageTrail(dt);
  }

  override dispose(): void {
    this.head.geometry.dispose();
    this.head.material.dispose();
    (this.glow.material as SpriteMaterial).dispose();
    this.outline.material.dispose();
    this.trail.geometry.dispose();
    (this.trail.material as PointsMaterial).dispose();
  }

  private emit(comet: CometState, radius: number, dt: number): void {
    this.emitDebt += dt * EMIT_PER_SECOND;
    const speed = Math.hypot(comet.vx, comet.vz) || 1;
    const backX = -comet.vx / speed;
    const backZ = -comet.vz / speed;
    while (this.emitDebt >= 1 && this.trailCount < TRAIL_PARTICLES) {
      this.emitDebt -= 1;
      const i = this.trailCount++;
      const spread = radius * 0.7;
      const drift = 2 + this.rng() * 6;
      this.positions[i * 3] = comet.x + (this.rng() - 0.5) * spread;
      this.positions[i * 3 + 1] = 0.5 + (this.rng() - 0.5) * spread * 0.5;
      this.positions[i * 3 + 2] = comet.z + (this.rng() - 0.5) * spread;
      this.velocities[i * 3] = backX * drift + (this.rng() - 0.5) * 1.6;
      this.velocities[i * 3 + 1] = (this.rng() - 0.5) * 0.6;
      this.velocities[i * 3 + 2] = backZ * drift + (this.rng() - 0.5) * 1.6;
      this.life[i] = TRAIL_LIFE * (0.6 + this.rng() * 0.4);
    }
    // When the buffer is full, drop the debt so we do not burst-emit later.
    if (this.trailCount >= TRAIL_PARTICLES) this.emitDebt = 0;
  }

  private ageTrail(dt: number): void {
    for (let i = this.trailCount - 1; i >= 0; i--) {
      this.life[i] = this.life[i]! - dt;
      if (this.life[i]! <= 0) {
        this.swapRemove(i);
        continue;
      }
      for (let axis = 0; axis < 3; axis++) {
        this.positions[i * 3 + axis] = this.positions[i * 3 + axis]! + this.velocities[i * 3 + axis]! * dt;
      }
      const t = Math.min(1, this.life[i]! / TRAIL_LIFE);
      // White-hot near the head, fading to blue and out.
      this.colours[i * 3] = 0.55 * t * t;
      this.colours[i * 3 + 1] = 0.75 * t * t;
      this.colours[i * 3 + 2] = 1.0 * t;
    }
    const geometry = this.trail.geometry;
    geometry.setDrawRange(0, this.trailCount);
    (geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  private swapRemove(i: number): void {
    const last = this.trailCount - 1;
    if (i !== last) {
      for (let axis = 0; axis < 3; axis++) {
        this.positions[i * 3 + axis] = this.positions[last * 3 + axis]!;
        this.velocities[i * 3 + axis] = this.velocities[last * 3 + axis]!;
        this.colours[i * 3 + axis] = this.colours[last * 3 + axis]!;
      }
      this.life[i] = this.life[last]!;
    }
    this.trailCount = last;
  }
}
