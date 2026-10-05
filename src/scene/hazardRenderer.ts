import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  type Blending,
  type Texture,
} from 'three';
import type { Hazard } from '../game/hazards';
import { createRng, type Rng } from '../game/random';
import { hashToUnit } from '../game/rocks';
import { NEBULA_FILES, spaceTexture } from './spaceAssets';

interface CloudLayer {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly spin: number;
  readonly phase: number;
}

interface Cloud {
  readonly hazard: Hazard;
  readonly layers: CloudLayer[];
  readonly hover: { value: number };
  readonly flash: { value: number };
  hoverTarget: number;
  nextFlash: number;
  flashStart: number;
}

/** Seconds between lightning flickers inside a cloud, min and max. */
const FLASH_GAP: readonly [number, number] = [4, 10];

/**
 * Gas clouds built from the same wispy nebula PNGs as the backdrop, laid
 * flat on the ship plane in offset, rotated, stretched layers so the shape
 * has no outline and no obvious centre. The art is faint, so each layer runs
 * through a small shader that lifts its alpha and shapes it against the
 * damage radius: a near-black base and two murky bodies make the middle
 * dark and dense, an additive fringe glows in the cloud's colour around the
 * edge of the damage area, and thin wisps trail past it. Nothing visibly
 * moves (layers turn a few degrees a minute and breathe a few percent); the
 * only motion is a rare lightning flicker deep inside, plus a sparse dust
 * of slow motes for depth under camera tilt. The damage circle is never
 * drawn as such.
 */
export class HazardRenderer extends Group {
  private readonly clouds: Cloud[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly time = { value: 0 };
  /** World XZ of the player's ship and the radius kept clear of gas around it. */
  private readonly focus = { value: new Vector2(1e9, 1e9) };
  private readonly focusRadius = { value: 12 };

  constructor(private readonly glowTexture: Texture) {
    super();
  }

  setHazards(hazards: readonly Hazard[]): void {
    this.clear();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
    this.clouds.length = 0;
    for (const hazard of hazards) this.buildCloud(hazard, createRng(Math.floor(hashToUnit(hazard.id) * 1e9)));
  }

  /** Thin the gas around a point so the ship inside stays readable; pass null when nothing needs clearing. */
  setFocus(point: { readonly x: number; readonly z: number; readonly radius: number } | null): void {
    if (point) {
      this.focus.value.set(point.x, point.z);
      this.focusRadius.value = point.radius;
    } else {
      this.focus.value.set(1e9, 1e9);
    }
  }

  setHovered(id: string | null): void {
    for (const cloud of this.clouds) cloud.hoverTarget = cloud.hazard.id === id ? 1 : 0;
  }

  update(dt: number, time: number): void {
    this.time.value = time;
    for (const cloud of this.clouds) {
      cloud.hover.value += (cloud.hoverTarget - cloud.hover.value) * Math.min(1, dt * 6);
      for (const layer of cloud.layers) layer.mesh.rotation.z = layer.phase + time * layer.spin;
      if (time >= cloud.nextFlash) {
        cloud.flashStart = time;
        cloud.nextFlash = time + FLASH_GAP[0] + hashToUnit(`${cloud.hazard.id}:${Math.floor(time)}`) * (FLASH_GAP[1] - FLASH_GAP[0]);
      }
      cloud.flash.value = flashCurve(time - cloud.flashStart);
    }
  }

  override dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.plane.dispose();
  }

  private buildCloud(hazard: Hazard, rng: Rng): void {
    const colour = new Color(hazard.colour);
    const dark = colour.clone().lerp(new Color('#03050a'), 0.9);
    const hover = { value: 0 };
    const flash = { value: 0 };
    const group = new Group();
    group.position.set(hazard.x, 0, hazard.z);
    this.add(group);

    const r = hazard.radius;
    const first = Math.floor(rng() * NEBULA_FILES.length);
    const art = (offset: number): string => NEBULA_FILES[(first + offset) % NEBULA_FILES.length]!;
    // Widths are in multiples of the damage radius; masks are in plane UV
    // distance from the centre (0.5 is the plane's edge), so the damage
    // radius sits at r / width. The outline is wobbled by the art, so the
    // visible mass reaches 1.2 to 1.7 r: you see the cloud well before it
    // hurts, and the glowing fringe sits around where the damage starts.
    const recipe: Array<{
      file: string;
      width: number;
      tint: Color;
      gain: number;
      texWeight: number;
      opacity: number;
      blending: Blending;
      maskInner: number;
      maskOuter: number;
      ring: number;
      coreDark: number;
      flashGain: number;
      offset: number;
    }> = [
      // Near-black base: dims the stars and makes the middle a dark mass.
      { file: art(0), width: 3.0, tint: dark, gain: 8, texWeight: 0.5, opacity: 0.7, blending: NormalBlending, maskInner: 0.3, maskOuter: 0.46, ring: 0, coreDark: 0, flashGain: 0.3, offset: 0.08 },
      // Two murky bodies in the cloud's colour, mostly art-driven so its gaps stay dark.
      { file: art(1), width: 2.8, tint: colour.clone().multiplyScalar(0.22), gain: 7, texWeight: 0.85, opacity: 0.75, blending: NormalBlending, maskInner: 0.3, maskOuter: 0.46, ring: 0, coreDark: 0.6, flashGain: 0.9, offset: 0.14 },
      { file: art(2), width: 2.4, tint: colour.clone().multiplyScalar(0.36), gain: 6, texWeight: 0.85, opacity: 0.55, blending: NormalBlending, maskInner: 0.33, maskOuter: 0.5, ring: 0, coreDark: 0.5, flashGain: 1.2, offset: 0.18 },
      // Venomous fringe: an additive glow around and beyond the damage radius.
      { file: art(1), width: 3.0, tint: colour.clone(), gain: 5, texWeight: 0.4, opacity: 0.5, blending: AdditiveBlending, maskInner: 0.3, maskOuter: 0.5, ring: 1, coreDark: 0, flashGain: 1.8, offset: 0.1 },
      // Thin wisps trailing well past it.
      { file: art(0), width: 4.0, tint: colour.clone().multiplyScalar(0.8), gain: 4, texWeight: 0.6, opacity: 0.16, blending: AdditiveBlending, maskInner: 0.3, maskOuter: 0.5, ring: 0, coreDark: 0, flashGain: 1.0, offset: 0.06 },
    ];
    const layers: CloudLayer[] = [];
    recipe.forEach((entry, index) => {
      const material = new ShaderMaterial({
        uniforms: {
          uMap: { value: null as Texture | null },
          uTint: { value: entry.tint },
          uDark: { value: dark },
          uGain: { value: entry.gain },
          uTexWeight: { value: entry.texWeight },
          uOpacity: { value: entry.opacity },
          uMaskInner: { value: entry.maskInner },
          uMaskOuter: { value: entry.maskOuter },
          uRing: { value: entry.ring },
          uCoreDark: { value: entry.coreDark },
          uFlashGain: { value: entry.flashGain },
          uBreathePhase: { value: rng() * Math.PI * 2 },
          uTime: this.time,
          uHover: hover,
          uFlash: flash,
          uFocus: this.focus,
          uFocusRadius: this.focusRadius,
        },
        vertexShader: CLOUD_VERTEX,
        fragmentShader: CLOUD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: entry.blending,
      });
      const mesh = new Mesh(this.plane, material);
      mesh.visible = false;
      material.uniforms['uMap']!.value = spaceTexture(entry.file, () => {
        mesh.visible = true;
      });
      const angle = rng() * Math.PI * 2;
      const distance = rng() * entry.offset * r;
      mesh.position.set(Math.cos(angle) * distance, 0.15 + index * 0.04, Math.sin(angle) * distance);
      const phase = rng() * Math.PI * 2;
      mesh.rotation.set(-Math.PI / 2, 0, phase);
      const width = entry.width * r;
      mesh.scale.set(width * (0.88 + rng() * 0.24), width * (0.88 + rng() * 0.24), 1);
      mesh.renderOrder = 1 + index;
      group.add(mesh);
      this.disposables.push(material);
      layers.push({ mesh, spin: (rng() < 0.5 ? -1 : 1) * (0.0015 + rng() * 0.003), phase });
    });

    this.buildDust(group, hazard, rng, colour, flash);
    this.clouds.push({ hazard, layers, hover, flash, hoverTarget: 0, nextFlash: 2 + rng() * FLASH_GAP[1], flashStart: -10 });
  }

  /** A sparse scatter of dim motes drifting so slowly they read as still, for a little depth under camera tilt. */
  private buildDust(group: Group, hazard: Hazard, rng: Rng, colour: Color, flash: { value: number }): void {
    const r = hazard.radius;
    const count = Math.min(140, Math.max(24, Math.round((r * r) / 700)));
    const geometry = new BufferGeometry();
    const seeds = new Float32Array(count * 4);
    const motion = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = rng() * Math.PI * 2;
      seeds[i * 4 + 1] = Math.pow(rng(), 0.7) * 1.2;
      seeds[i * 4 + 2] = 0.5 + rng() * 0.7;
      seeds[i * 4 + 3] = rng() * Math.PI * 2;
      motion[i * 3] = (rng() < 0.5 ? -1 : 1) * (0.003 + rng() * 0.006);
      motion[i * 3 + 1] = 0.15 + rng() * 0.25;
      motion[i * 3 + 2] = 0.6 + rng() * 3.4;
    }
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    geometry.setAttribute('aMotion', new BufferAttribute(motion, 3));
    geometry.boundingSphere = new Sphere(new Vector3(0, 2, 0), r * 1.3 + 4);
    const material = new PointsMaterial({
      map: this.glowTexture,
      color: colour.clone().lerp(new Color('#ffffff'), 0.3),
      size: 1,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const uniforms = { uTime: this.time, uRadius: { value: r }, uFlash: flash };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${DUST_VERTEX_HEADER}`)
        .replace('#include <begin_vertex>', DUST_VERTEX_BODY)
        .replace('gl_PointSize = size;', DUST_POINT_SIZE);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vAlpha;');
    };
    material.customProgramCacheKey = () => 'hazard-dust';
    const points = new Points(geometry, material);
    points.renderOrder = 8;
    group.add(points);
    this.disposables.push(geometry, material);
  }
}

/** A short double blink: bright, dip, bright again, then gone within a quarter second. */
function flashCurve(sinceStart: number): number {
  if (sinceStart < 0 || sinceStart > 0.28) return 0;
  if (sinceStart < 0.06) return 1;
  if (sinceStart < 0.1) return 0.25;
  if (sinceStart < 0.16) return 0.8;
  return Math.max(0, 1 - (sinceStart - 0.16) / 0.12) * 0.8;
}

const CLOUD_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  vUv = uv;
  vWorld = (modelMatrix * vec4(position, 1.0)).xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform vec3 uDark;
uniform float uGain;
uniform float uTexWeight;
uniform float uOpacity;
uniform float uMaskInner;
uniform float uMaskOuter;
uniform float uRing;
uniform float uCoreDark;
uniform float uFlashGain;
uniform float uBreathePhase;
uniform float uTime;
uniform float uHover;
uniform float uFlash;
uniform vec2 uFocus;
uniform float uFocusRadius;
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  // The nebula art is faint; lift its alpha so the cloud has real body.
  float tex = texture2D(uMap, vUv).a;
  float boosted = 1.0 - pow(1.0 - tex, uGain);
  // A second, larger-scale sample wobbles the outline so no layer is a disc.
  float shape = 1.0 - pow(1.0 - texture2D(uMap, vUv * 0.6 + vec2(0.2)).a, 5.0);
  vec2 p = vUv - 0.5;
  float d = length(p) * (1.12 - 0.3 * shape);
  float outer = 1.0 - smoothstep(uMaskInner, uMaskOuter, d);
  float inner = smoothstep(uMaskInner - 0.11, uMaskInner, d);
  float mask = mix(outer, outer * inner, uRing);
  float density = mask * mix(1.0, boosted, uTexWeight);
  float core = 1.0 - smoothstep(0.0, uMaskInner, d);
  // Dense parts of the middle go dark and murky.
  vec3 colour = mix(uTint, uDark, uCoreDark * core * boosted);
  float flash = uFlash * uFlashGain * core;
  colour += (uTint + vec3(0.3)) * flash;
  float breathe = 1.0 + 0.04 * sin(uTime * 0.4 + uBreathePhase);
  float alpha = density * uOpacity * breathe * (1.0 + 0.3 * uHover + 0.6 * flash);
  // Keep the ship readable: the gas thins to a quarter around the focus point.
  float clear = smoothstep(uFocusRadius * 0.6, uFocusRadius * 1.6, distance(vWorld, uFocus));
  alpha *= mix(0.25, 1.0, clear);
  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}
`;

const DUST_VERTEX_HEADER = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uFlash;
attribute vec4 aSeed;
attribute vec3 aMotion;
varying float vAlpha;
`;

const DUST_VERTEX_BODY = /* glsl */ `
vec3 transformed = vec3(position);
{
  float angle = aSeed.x + uTime * aMotion.x;
  float rr = aSeed.y * uRadius;
  float bob = 0.2 * sin(uTime * aMotion.y + aSeed.w);
  transformed = vec3(cos(angle) * rr, aMotion.z + bob, sin(angle) * rr);
  float glow = 0.75 + 0.25 * sin(uTime * aMotion.y * 0.7 + aSeed.w * 2.0);
  vAlpha = glow * smoothstep(1.25, 0.6, aSeed.y) * (1.0 + 2.0 * uFlash);
}
`;

/** Point size as a true world-space diameter in both camera modes (assumes a full-resolution pass). */
const DUST_POINT_SIZE = /* glsl */ `
gl_PointSize = size * aSeed.z * scale * projectionMatrix[1][1];
if (isPerspectiveMatrix(projectionMatrix)) gl_PointSize /= -mvPosition.z;
`;
