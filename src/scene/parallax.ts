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
import type { ResolvedScenery, StarLayerSpec } from '../game/map';
import { pick, range, type Rng } from '../game/random';
import type { CameraMode } from './cameraRig';
import { MOON_ART, PLANET_ART, STAR_SPRITE_FILE, SUN_SPRITE_FILE, spaceTexture, type PlanetArt } from './spaceAssets';

export type { StarLayerSpec };

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

/** Look up planet or moon art by name, falling back to the first planet. */
function planetArt(name: string): PlanetArt {
  const all = [...PLANET_ART, ...MOON_ART];
  return all.find((art) => art.file === `${name}.png` || art.file === name) ?? PLANET_ART[0]!;
}

/** Build the whole background for a square map from a resolved scenery definition. */
export function createParallaxWorld(rng: Rng, _halfExtent: number, scenery: ResolvedScenery): ParallaxWorld {
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

  for (const spec of scenery.stars) layerAt(spec.depth).addStars(new TiledStars(spec, rng));

  // Planets and moons as dimmed billboards so they sit behind the action.
  const planetPositions: Array<readonly [number, number]> = [];
  for (const planet of scenery.planets) {
    const art = planetArt(planet.art);
    const { sprite, material } = billboard(art.file, (2 * planet.radius) / art.discFraction, { rotation: planet.rotation, tint: '#b4bccb', opacity: 0.85 });
    disposables.push(material);
    sprite.position.set(planet.x, planet.depth, planet.z);
    layerAt(planet.depth).add(sprite);
    planetPositions.push([planet.x, planet.z]);
  }

  if (scenery.sun) {
    const sun = billboard(SUN_SPRITE_FILE, scenery.sun.size, { additive: true, opacity: 0.85 });
    disposables.push(sun.material);
    sun.sprite.position.set(scenery.sun.x, scenery.sun.depth, scenery.sun.z);
    layerAt(scenery.sun.depth).add(sun.sprite);
  }

  if (scenery.band) {
    const band = billboard(`${scenery.band.art}.png`, scenery.band.width, { tint: scenery.band.tint, opacity: scenery.band.opacity, additive: true, rotation: scenery.band.rotation });
    disposables.push(band.material);
    band.sprite.scale.set(scenery.band.width, scenery.band.height, 1);
    band.sprite.position.set(scenery.band.x, scenery.band.depth, scenery.band.z);
    layerAt(scenery.band.depth).add(band.sprite);
  }

  for (const nebula of scenery.nebulae) {
    const { sprite, material } = billboard(`${nebula.art}.png`, nebula.size, { tint: nebula.tint, opacity: nebula.opacity, additive: true, rotation: nebula.rotation });
    disposables.push(material);
    sprite.position.set(nebula.x, nebula.depth, nebula.z);
    layerAt(nebula.depth).add(sprite);
  }

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
