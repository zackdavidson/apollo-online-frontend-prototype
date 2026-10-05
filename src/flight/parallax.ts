import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  type IUniform,
} from 'three';
import type { CameraMode } from './cameraRig';
import { pick, range, type Rng } from './random';
import { MOON_ART, NEBULA_FILES, PLANET_ART, STAR_SPRITE_FILE, SUN_SPRITE_FILE, spaceTexture, type PlanetArt } from './spaceAssets';

/**
 * Parallax background, entirely 2D: star point sprites and PNG billboards for
 * planets, moons, nebulae and a sun. Every layer lives at a real depth below
 * (or above) the ship plane. With the perspective camera that depth produces
 * parallax on its own. With the orthographic camera it would not, so each
 * layer is translated and scaled every frame to reproduce the same screen
 * motion: a point P at depth d seen from a camera at C maps to C + (P - C) * f,
 * which is exactly `position = C * (1 - f), scale = f`.
 */

/** Screen-motion ratio of a layer relative to the ship plane. */
export function parallaxFactor(cameraHeight: number, depth: number): number {
  const separation = cameraHeight - depth;
  if (separation <= 1e-3) return 2.5;
  return Math.min(2.5, Math.max(0.004, cameraHeight / separation));
}

/** Lower corner of the tile containing `coord`. */
export function tileOrigin(coord: number, tile: number): number {
  return Math.floor(coord / tile) * tile;
}

export interface StarLayerSpec {
  readonly kind: 'field' | 'clusters';
  readonly depth: number;
  /** Tile edge length; 3x3 tiles are kept around the camera. */
  readonly tile: number;
  readonly count: number;
  /** Number of clumps per tile for the 'clusters' kind. */
  readonly clusters?: number;
  /** Point size in world units for the perspective camera (which attenuates with distance). */
  readonly sizeWorld: number;
  /** Point size in pixels for the orthographic camera (no attenuation). */
  readonly sizePx: number;
  /** Peak brightness multiplier; twinkle dips well below it. */
  readonly brightness: number;
}

/**
 * Starfields sit far below everything else, so they are the slowest-moving
 * thing on screen: a dense faint field, a medium field, clustered clumps and
 * a sparse scatter of bright coloured giants.
 */
export const STAR_LAYERS: readonly StarLayerSpec[] = [
  { kind: 'field', depth: -3200, tile: 5000, count: 2600, sizeWorld: 14, sizePx: 1.6, brightness: 0.55 },
  { kind: 'clusters', depth: -3800, tile: 6000, count: 1400, clusters: 7, sizeWorld: 17, sizePx: 1.8, brightness: 0.7 },
  { kind: 'field', depth: -4200, tile: 6500, count: 900, sizeWorld: 25, sizePx: 2.4, brightness: 0.9 },
  { kind: 'field', depth: -5200, tile: 8000, count: 180, sizeWorld: 42, sizePx: 3.4, brightness: 1.3 },
];

/** Planets live well below the play plane so they loom large but barely move; stars sit below them. */
export const PLANET_DEPTHS = { hero: -2400, heroMoon: -2100, far: -2800, gas: -2600, farMoon: -2000 } as const;
export const SUN_DEPTH = -7000;
export const NEBULA_DEPTH = -6000;
export const BAND_DEPTH = -6500;

/** Approximate stellar colours, weighted towards the common yellow-white. */
const STAR_COLOURS: ReadonlyArray<readonly [string, number]> = [
  ['#9fb8ff', 0.1],
  ['#ffffff', 0.25],
  ['#fff4dc', 0.35],
  ['#ffd9a0', 0.2],
  ['#ffb07a', 0.1],
];
/** Scintillation tints a star briefly shifts towards. */
const FLASH_TINTS = ['#8fb0ff', '#ff9a8a', '#a8ffcf', '#ffe08a'];

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Standard normal sample (Box-Muller). */
function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pickWeighted(rng: Rng, options: ReadonlyArray<readonly [string, number]>): string {
  let roll = rng();
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1]![0];
}

/**
 * A star tile repeated 3x3 around the camera so the field is endless. Stars
 * are soft PNG point sprites; each carries a twinkle phase and speed plus a
 * second colour, and the vertex shader dims it and shifts it towards that
 * colour over time.
 */
export class TiledStars extends Group {
  private readonly copies: Points[] = [];
  private readonly material: PointsMaterial;
  private readonly uTime: IUniform<number> = { value: 0 };

  constructor(private readonly spec: StarLayerSpec, rng: Rng) {
    super();
    const positions = new Float32Array(spec.count * 3);
    const colours = new Float32Array(spec.count * 3);
    const altColours = new Float32Array(spec.count * 3);
    const twinkle = new Float32Array(spec.count * 2);
    const colour = new Color();
    const tint = new Color();
    const clusterCentres = Array.from({ length: spec.clusters ?? 0 }, () => [rng() * spec.tile, rng() * spec.tile] as const);
    for (let i = 0; i < spec.count; i++) {
      let x = rng() * spec.tile;
      let z = rng() * spec.tile;
      if (spec.kind === 'clusters' && clusterCentres.length > 0) {
        const [cx, cz] = pick(rng, clusterCentres);
        const spread = spec.tile * 0.035;
        x = wrap(cx + gaussian(rng) * spread, spec.tile);
        z = wrap(cz + gaussian(rng) * spread, spec.tile);
      }
      positions[i * 3] = x;
      positions[i * 3 + 1] = spec.depth;
      positions[i * 3 + 2] = z;
      // A few bright stars, most faint.
      const magnitude = rng() < 0.08 ? range(rng, 1.3, 1.8) : range(rng, 0.35, 1.0);
      colour.set(pickWeighted(rng, STAR_COLOURS)).multiplyScalar(spec.brightness * magnitude);
      colour.toArray(colours, i * 3);
      tint.set(pick(rng, FLASH_TINTS)).multiplyScalar(spec.brightness * magnitude);
      tint.lerp(colour, 0.45);
      tint.toArray(altColours, i * 3);
      twinkle[i * 2] = rng() * Math.PI * 2;
      twinkle[i * 2 + 1] = range(rng, 0.6, 3.2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colours, 3));
    geometry.setAttribute('altColor', new BufferAttribute(altColours, 3));
    geometry.setAttribute('twinkle', new BufferAttribute(twinkle, 2));

    this.material = new PointsMaterial({
      map: spaceTexture(STAR_SPRITE_FILE),
      size: spec.sizeWorld,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const uTime = this.uTime;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 altColor;
attribute vec2 twinkle;
uniform float uTime;
float starTwinkle = 0.0;`,
        )
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
starTwinkle = sin(uTime * twinkle.y + twinkle.x);
float starShift = 0.5 + 0.5 * sin(uTime * twinkle.y * 0.37 + twinkle.x * 1.9);
vColor.rgb = mix(vColor.rgb, altColor, starShift) * (0.55 + 0.45 * starTwinkle);`,
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = size * (0.85 + 0.15 * starTwinkle);');
    };
    this.material.customProgramCacheKey = () => 'twinkling-stars';

    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const points = new Points(geometry, this.material);
        points.frustumCulled = false;
        this.copies.push(points);
        this.add(points);
      }
    }
  }

  setMode(mode: CameraMode): void {
    this.material.size = mode === 'perspective' ? this.spec.sizeWorld : this.spec.sizePx;
  }

  setTime(seconds: number): void {
    this.uTime.value = seconds;
  }

  /** Re-anchor the 3x3 block so the (layer-local) camera is in the centre tile. */
  recentre(camX: number, camZ: number): void {
    const ox = tileOrigin(camX, this.spec.tile);
    const oz = tileOrigin(camZ, this.spec.tile);
    let k = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        this.copies[k++]!.position.set(ox + i * this.spec.tile, 0, oz + j * this.spec.tile);
      }
    }
  }

  override dispose(): void {
    this.copies[0]?.geometry.dispose();
    this.material.dispose();
  }
}

/** A group of content at one depth, with the orthographic parallax emulation. */
export class ParallaxLayer extends Group {
  private readonly stars: TiledStars[] = [];

  constructor(readonly depth: number) {
    super();
  }

  addStars(stars: TiledStars): void {
    this.stars.push(stars);
    this.add(stars);
  }

  update(mode: CameraMode, cameraHeight: number, camX: number, camZ: number, time: number): void {
    if (mode === 'orthographic') {
      const f = parallaxFactor(cameraHeight, this.depth);
      this.position.set(camX * (1 - f), 0, camZ * (1 - f));
      this.scale.setScalar(f);
    } else {
      this.position.set(0, 0, 0);
      this.scale.setScalar(1);
    }
    // In both modes the layer-local camera position equals the world one.
    for (const stars of this.stars) {
      stars.setMode(mode);
      stars.setTime(time);
      stars.recentre(camX, camZ);
    }
  }
}

export interface ParallaxWorld {
  readonly layers: readonly ParallaxLayer[];
  readonly planetPositions: ReadonlyArray<readonly [number, number]>;
  update(mode: CameraMode, cameraHeight: number, camX: number, camZ: number, time: number): void;
  dispose(): void;
}

const NEBULA_TINTS = ['#6a3fb0', '#2a7a8c', '#8c2a5a', '#2f5fa8'];

/** A PNG billboard that stays hidden until its texture has arrived. */
function billboard(file: string, size: number, options: { tint?: string; opacity?: number; additive?: boolean; rotation?: number } = {}): {
  sprite: Sprite;
  material: SpriteMaterial;
} {
  const material = new SpriteMaterial({
    transparent: true,
    opacity: options.opacity ?? 1,
    depthWrite: false,
    ...(options.additive ? { blending: AdditiveBlending } : {}),
    ...(options.tint ? { color: new Color(options.tint) } : {}),
    rotation: options.rotation ?? 0,
  });
  const sprite = new Sprite(material);
  sprite.visible = false;
  material.map = spaceTexture(file, () => {
    material.needsUpdate = true;
    sprite.visible = true;
  });
  sprite.scale.set(size, size, 1);
  return { sprite, material };
}

/** Build the whole background for a square map of `halfExtent` half size. */
export function createParallaxWorld(rng: Rng, halfExtent: number): ParallaxWorld {
  const layers: ParallaxLayer[] = [];
  const layerAt = (depth: number): ParallaxLayer => {
    let layer = layers.find((candidate) => candidate.depth === depth);
    if (!layer) {
      layer = new ParallaxLayer(depth);
      layers.push(layer);
    }
    return layer;
  };
  const disposables: { dispose(): void }[] = [];

  for (const spec of STAR_LAYERS) layerAt(spec.depth).addStars(new TiledStars(spec, rng));

  // A handful of planets and moons, very deep and slightly dimmed so they
  // sit behind the action rather than compete with it.
  const planetPositions: Array<readonly [number, number]> = [];
  const placePlanet = (x: number, z: number, depth: number, radius: number, art: PlanetArt): void => {
    const { sprite, material } = billboard(art.file, (2 * radius) / art.discFraction, {
      rotation: range(rng, -0.5, 0.5),
      tint: '#b4bccb',
      opacity: 0.85,
    });
    disposables.push(material);
    sprite.position.set(x, depth, z);
    layerAt(depth).add(sprite);
    planetPositions.push([x, z]);
  };
  placePlanet(680, 430, PLANET_DEPTHS.hero, 380, PLANET_ART[0]!);
  placePlanet(520, 300, PLANET_DEPTHS.heroMoon, 60, MOON_ART[0]!);
  placePlanet(-1700, -1400, PLANET_DEPTHS.far, 500, PLANET_ART[2]!);
  placePlanet(3200, -1800, PLANET_DEPTHS.gas, 420, PLANET_ART[1]!);
  placePlanet(3000, -1500, PLANET_DEPTHS.farMoon, 70, MOON_ART[1]!);

  // A distant, soft sun.
  const sun = billboard(SUN_SPRITE_FILE, 7000, { additive: true, opacity: 0.85 });
  disposables.push(sun.material);
  sun.sprite.position.set(-4500, SUN_DEPTH, 3500);
  layerAt(SUN_DEPTH).add(sun.sprite);

  // A faint galactic band across the sky.
  const band = billboard(NEBULA_FILES[1]!, 9000, { tint: '#8fa6d8', opacity: 0.22, additive: true, rotation: 0.55 });
  disposables.push(band.material);
  band.sprite.scale.set(9000 * 3.4, 9000 * 0.8, 1);
  band.sprite.position.set(1500, BAND_DEPTH, 2500);
  layerAt(BAND_DEPTH).add(band.sprite);

  // Nebulae: huge tinted PNG clouds, far behind everything.
  const placeNebula = (x: number, z: number, size: number): void => {
    const { sprite, material } = billboard(pick(rng, NEBULA_FILES), size, {
      tint: pick(rng, NEBULA_TINTS),
      opacity: 0.55,
      additive: true,
      rotation: rng() * Math.PI * 2,
    });
    disposables.push(material);
    sprite.position.set(x, NEBULA_DEPTH, z);
    layerAt(NEBULA_DEPTH).add(sprite);
  };
  placeNebula(-3000, 4800, 6500);
  for (let i = 0; i < 7; i++) placeNebula(range(rng, -halfExtent * 4, halfExtent * 4), range(rng, -halfExtent * 4, halfExtent * 4), range(rng, 4000, 9000));

  // Draw order: deepest first.
  layers.sort((a, b) => a.depth - b.depth);

  return {
    layers,
    planetPositions,
    update(mode, cameraHeight, camX, camZ, time) {
      for (const layer of layers) layer.update(mode, cameraHeight, camX, camZ, time);
    },
    dispose() {
      for (const layer of layers) {
        layer.traverse((object) => {
          if (object instanceof TiledStars) object.dispose();
        });
      }
      for (const disposable of disposables) disposable.dispose();
    },
  };
}

/** Square outline of the playable area on the ship plane. */
export function createBoundary(halfExtent: number, colour: string): LineSegments {
  const h = halfExtent;
  const positions = new Float32Array([-h, 0, -h, h, 0, -h, h, 0, -h, h, 0, h, h, 0, h, -h, 0, h, -h, 0, h, -h, 0, -h]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color: colour, transparent: true, opacity: 0.6 }));
  lines.frustumCulled = false;
  return lines;
}
