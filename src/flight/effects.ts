import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import type { Rng } from './random';

const MAX_DEBRIS = 1500;
const DEBRIS_LIFE = 0.9;
const FLASH_LIFE = 0.28;
const FLASH_POOL = 16;
const SHOCKWAVE_LIFE = 0.55;
const SHOCKWAVE_POOL = 8;

/** Short-lived rock chips and impact flashes. Cheap: one Points object and a few sprites. */
export class EffectsSystem extends Group {
  private readonly debrisPositions = new Float32Array(MAX_DEBRIS * 3);
  private readonly debrisColours = new Float32Array(MAX_DEBRIS * 3);
  private readonly debrisVelocity = new Float32Array(MAX_DEBRIS * 3);
  private readonly debrisBase = new Float32Array(MAX_DEBRIS * 3);
  private readonly debrisLife = new Float32Array(MAX_DEBRIS);
  private debrisCount = 0;
  private readonly debris: Points;
  private readonly flashes: { sprite: Sprite; life: number; size: number }[] = [];
  private readonly shockwaves: { mesh: Mesh<RingGeometry, MeshBasicMaterial>; life: number; radius: number }[] = [];
  private readonly ringGeometry = new RingGeometry(0.92, 1, 48);
  private readonly scratch = new Color();

  private readonly glowTexture = createGlowTexture();

  constructor(private readonly rng: Rng) {
    super();
    const glowTexture = this.glowTexture;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.debrisPositions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.debrisColours, 3));
    geometry.setDrawRange(0, 0);
    this.debris = new Points(
      geometry,
      new PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true }),
    );
    this.debris.frustumCulled = false;
    this.add(this.debris);

    for (let i = 0; i < FLASH_POOL; i++) {
      const sprite = new Sprite(
        new SpriteMaterial({ map: glowTexture, color: 0xffe2b0, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
      );
      sprite.visible = false;
      this.flashes.push({ sprite, life: 0, size: 1 });
      this.add(sprite);
    }
    for (let i = 0; i < SHOCKWAVE_POOL; i++) {
      const mesh = new Mesh(
        this.ringGeometry,
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.shockwaves.push({ mesh, life: 0, radius: 1 });
      this.add(mesh);
    }
  }

  /** An expanding ring on the ship plane, for explosions and heavy impacts. */
  shockwave(x: number, z: number, radius: number, colour: string): void {
    const slot = this.shockwaves.find((w) => w.life <= 0) ?? this.shockwaves[0]!;
    slot.life = SHOCKWAVE_LIFE;
    slot.radius = radius;
    slot.mesh.position.set(x, 0.4, z);
    slot.mesh.material.color.set(colour);
    slot.mesh.visible = true;
  }

  /** Spray `count` chips from a point; `speed` sets how violently. */
  burst(x: number, z: number, count: number, speed: number, colour: string): void {
    this.scratch.set(colour);
    for (let n = 0; n < count && this.debrisCount < MAX_DEBRIS; n++) {
      const i = this.debrisCount++;
      const angle = this.rng() * Math.PI * 2;
      const magnitude = speed * (0.3 + this.rng() * 0.7);
      this.debrisPositions[i * 3] = x;
      this.debrisPositions[i * 3 + 1] = (this.rng() - 0.5) * 0.6;
      this.debrisPositions[i * 3 + 2] = z;
      this.debrisVelocity[i * 3] = Math.cos(angle) * magnitude;
      this.debrisVelocity[i * 3 + 1] = (this.rng() - 0.5) * magnitude * 0.4;
      this.debrisVelocity[i * 3 + 2] = Math.sin(angle) * magnitude;
      const shade = 0.6 + this.rng() * 0.4;
      this.debrisBase[i * 3] = this.scratch.r * shade;
      this.debrisBase[i * 3 + 1] = this.scratch.g * shade;
      this.debrisBase[i * 3 + 2] = this.scratch.b * shade;
      this.debrisLife[i] = DEBRIS_LIFE * (0.6 + this.rng() * 0.4);
    }
  }

  flash(x: number, z: number, size: number): void {
    const slot = this.flashes.find((f) => f.life <= 0) ?? this.flashes[0]!;
    slot.life = FLASH_LIFE;
    slot.size = size;
    slot.sprite.position.set(x, 0.5, z);
    slot.sprite.visible = true;
  }

  update(dt: number): void {
    const damping = Math.exp(-2.2 * dt);
    for (let i = this.debrisCount - 1; i >= 0; i--) {
      this.debrisLife[i] = this.debrisLife[i]! - dt;
      if (this.debrisLife[i]! <= 0) {
        this.swapRemove(i);
        continue;
      }
      for (let axis = 0; axis < 3; axis++) {
        this.debrisVelocity[i * 3 + axis] = this.debrisVelocity[i * 3 + axis]! * damping;
        this.debrisPositions[i * 3 + axis] = this.debrisPositions[i * 3 + axis]! + this.debrisVelocity[i * 3 + axis]! * dt;
      }
      const fade = Math.min(1, this.debrisLife[i]! / (DEBRIS_LIFE * 0.4));
      for (let axis = 0; axis < 3; axis++) this.debrisColours[i * 3 + axis] = this.debrisBase[i * 3 + axis]! * fade;
    }
    const geometry = this.debris.geometry;
    geometry.setDrawRange(0, this.debrisCount);
    (geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;

    for (const wave of this.shockwaves) {
      if (wave.life <= 0) continue;
      wave.life -= dt;
      const t = Math.max(0, wave.life / SHOCKWAVE_LIFE);
      const scale = wave.radius * (0.15 + 0.85 * (1 - t));
      wave.mesh.scale.set(scale, scale, 1);
      wave.mesh.material.opacity = t * t * 0.5;
      if (wave.life <= 0) wave.mesh.visible = false;
    }
    for (const flash of this.flashes) {
      if (flash.life <= 0) continue;
      flash.life -= dt;
      const t = Math.max(0, flash.life / FLASH_LIFE);
      const scale = flash.size * (1.6 - t);
      flash.sprite.scale.set(scale, scale, 1);
      (flash.sprite.material as SpriteMaterial).opacity = t * 0.9;
      if (flash.life <= 0) flash.sprite.visible = false;
    }
  }

  override dispose(): void {
    this.debris.geometry.dispose();
    (this.debris.material as PointsMaterial).dispose();
    for (const flash of this.flashes) (flash.sprite.material as SpriteMaterial).dispose();
    for (const wave of this.shockwaves) wave.mesh.material.dispose();
    this.ringGeometry.dispose();
    this.glowTexture.dispose();
  }

  private swapRemove(i: number): void {
    const last = this.debrisCount - 1;
    if (i !== last) {
      for (let axis = 0; axis < 3; axis++) {
        this.debrisPositions[i * 3 + axis] = this.debrisPositions[last * 3 + axis]!;
        this.debrisVelocity[i * 3 + axis] = this.debrisVelocity[last * 3 + axis]!;
        this.debrisBase[i * 3 + axis] = this.debrisBase[last * 3 + axis]!;
        this.debrisColours[i * 3 + axis] = this.debrisColours[last * 3 + axis]!;
      }
      this.debrisLife[i] = this.debrisLife[last]!;
    }
    this.debrisCount = last;
  }
}

/** Soft radial gradient used for impact flashes and shield bubbles. */
export function createGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
