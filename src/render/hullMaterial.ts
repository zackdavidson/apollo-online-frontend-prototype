import { Color, DataTexture, DoubleSide, MeshStandardMaterial, NoColorSpace, RepeatWrapping, Texture, TextureLoader, Vector2, Vector3, Vector4, type IUniform } from 'three';
import { materialAssetPath, type MaterialDefinition } from '../core/materials';
import type { PaletteRole } from '../core/palette';

export interface HullUniforms {
  readonly uHullMap: IUniform<Texture>;
  readonly uHullGlowMap: IUniform<Texture>;
  /** World units per repeat of the tile. */
  readonly uHullScale: IUniform<number>;
  /** Tile drift in repeats per second. */
  readonly uHullScroll: IUniform<Vector2>;
  /** 0 paints the hull colour alone (also while the tiles are still loading). */
  readonly uHullStrength: IUniform<number>;
  /** Coverage of the main, trim, dark and metal roles, in that order. */
  readonly uHullRoles: IUniform<Vector4>;
  /** Glow colour times intensity, linear. */
  readonly uHullGlow: IUniform<Vector3>;
  readonly uHullPulse: IUniform<number>;
  readonly uHullDrift: IUniform<number>;
  readonly uHullTime: IUniform<number>;
}

export interface HullMaterialHandle {
  readonly material: MeshStandardMaterial;
  readonly uniforms: HullUniforms;
}

/** Roles the lit mesh can wear a material on, in the order `uHullRoles` packs them. */
const COVERABLE_ROLES: readonly PaletteRole[] = ['main', 'trim', 'dark', 'metal'];

const VERTEX_PARS = `
attribute float hullRole;
varying vec3 vHullPos;
varying vec3 vHullNormal;
varying float vHullRole;`;

const VERTEX_BODY = `
vHullPos = position;
vHullNormal = normal;
vHullRole = hullRole;`;

const FRAGMENT_PARS = `
uniform sampler2D uHullMap;
uniform sampler2D uHullGlowMap;
uniform float uHullScale;
uniform vec2 uHullScroll;
uniform float uHullStrength;
uniform vec4 uHullRoles;
uniform vec3 uHullGlow;
uniform float uHullPulse;
uniform float uHullDrift;
uniform float uHullTime;
varying vec3 vHullPos;
varying vec3 vHullNormal;
varying float vHullRole;
float hullGlowAmount = 0.0;

// Overlay blend: mid grey leaves the base alone, darker texels shade it, lighter ones brighten it.
vec3 hullOverlay(vec3 base, vec3 blend) {
  vec3 dark = 2.0 * base * blend;
  vec3 light = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return mix(dark, light, step(0.5, base));
}

// The hull has no UVs: project the tile along the three object axes and blend by the normal.
vec4 hullTriplanar(sampler2D map, vec2 shift) {
  vec3 w = pow(abs(normalize(vHullNormal)), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 p = vHullPos / uHullScale;
  return texture2D(map, p.zy + shift) * w.x + texture2D(map, p.xz + shift) * w.y + texture2D(map, p.xy + shift) * w.z;
}

float hullCoverage() {
  if (vHullRole < 0.5) return uHullRoles.x;
  if (vHullRole < 1.5) return uHullRoles.y;
  if (vHullRole < 2.5) return uHullRoles.z;
  if (vHullRole < 3.5) return uHullRoles.w;
  return 0.0;
}`;

const COLOUR_BODY = `
#include <color_fragment>
{
  float hullWeight = hullCoverage() * uHullStrength;
  if (hullWeight > 0.0) {
    vec2 hullShift = uHullScroll * uHullTime;
    vec3 hullTile = hullTriplanar(uHullMap, hullShift).rgb;
    // Blend in gamma space so the tile's mid grey really is the "no change" point.
    vec3 hullBase = pow(diffuseColor.rgb, vec3(1.0 / 2.2));
    vec3 hullMixed = pow(hullOverlay(hullBase, hullTile), vec3(2.2));
    diffuseColor.rgb = mix(diffuseColor.rgb, hullMixed, hullWeight);
    float glow = hullTriplanar(uHullGlowMap, hullShift).r;
    if (uHullDrift != 0.0) {
      glow = max(glow, 0.8 * hullTriplanar(uHullGlowMap, hullShift * uHullDrift + vec2(0.37, 0.61)).r);
    }
    hullGlowAmount = glow * hullWeight;
  }
}`;

const EMISSIVE_BODY = `
#include <emissivemap_fragment>
{
  float breath = 1.0 - uHullPulse * 0.5 * (1.0 + sin(uHullTime * 2.1 + vHullPos.x * 0.6 + vHullPos.z * 0.9));
  totalEmissiveRadiance += uHullGlow * hullGlowAmount * breath;
}`;

/**
 * The lit hull material: a standard PBR material with a tiled, scrolling
 * overlay sampled triplanar in object space, and a glow mask fed into the
 * emissive term. One program serves every ship; swapping materials only
 * changes uniforms, so the hangar picker and NPC skins cost no recompiles.
 */
export function createHullMaterial(): HullMaterialHandle {
  const uniforms: HullUniforms = {
    uHullMap: { value: neutralTile() },
    uHullGlowMap: { value: blackTile() },
    uHullScale: { value: 1 },
    uHullScroll: { value: new Vector2() },
    uHullStrength: { value: 0 },
    uHullRoles: { value: new Vector4() },
    uHullGlow: { value: new Vector3() },
    uHullPulse: { value: 0 },
    uHullDrift: { value: 0 },
    uHullTime: { value: 0 },
  };
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2, side: DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', COLOUR_BODY)
      .replace('#include <emissivemap_fragment>', EMISSIVE_BODY);
  };
  material.customProgramCacheKey = () => 'ship-hull-material';
  return { material, uniforms };
}

export interface HullMaps {
  readonly map: Texture | null;
  readonly glow: Texture | null;
}

/**
 * Point the uniforms at a material. `ready` is false while its tiles are
 * still downloading: the hull stays plain rather than showing an empty
 * texture, and the caller applies again once they arrive.
 */
export function applyHullMaterial(uniforms: HullUniforms, definition: MaterialDefinition, maps: HullMaps, ready: boolean): void {
  uniforms.uHullMap.value = maps.map ?? neutralTile();
  uniforms.uHullGlowMap.value = maps.glow ?? blackTile();
  uniforms.uHullScale.value = definition.scale;
  uniforms.uHullScroll.value.set(definition.scroll[0], definition.scroll[1]);
  uniforms.uHullStrength.value = definition.texture !== null && ready ? 1 : 0;
  const [main, trim, dark, metal] = COVERABLE_ROLES.map((role) => (definition.roles.includes(role) ? 1 : 0));
  uniforms.uHullRoles.value.set(main!, trim!, dark!, metal!);
  const glow = definition.glow;
  const colour = new Color(glow?.colour ?? '#000000');
  const intensity = glow?.intensity ?? 0;
  uniforms.uHullGlow.value.set(colour.r * intensity, colour.g * intensity, colour.b * intensity);
  uniforms.uHullPulse.value = glow?.pulse ?? 0;
  uniforms.uHullDrift.value = glow?.drift ?? 0;
}

// ---- tile loading ----------------------------------------------------------

export interface HullTexture {
  readonly texture: Texture;
  /** True once the image has arrived (false for good if it failed; the hull stays plain). */
  loaded: boolean;
  readonly ready: Promise<void>;
}

const tiles = new Map<string, HullTexture>();
let loader: TextureLoader | null = null;

export function hullMaterialUrl(file: string): string {
  return `${import.meta.env.BASE_URL}${materialAssetPath(file)}`;
}

/** The shared tile for a file, loading it on first use. Every ship wearing the material samples the same texture. */
export function hullTexture(file: string): HullTexture {
  const existing = tiles.get(file);
  if (existing) return existing;
  loader ??= new TextureLoader();
  let settle = (): void => {};
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const entry: HullTexture = { texture: new Texture(), loaded: false, ready };
  const texture = loader.load(
    hullMaterialUrl(file),
    () => {
      entry.loaded = true;
      settle();
    },
    undefined,
    () => settle(),
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // Raw values: the shader blends the tile in gamma space itself.
  texture.colorSpace = NoColorSpace;
  (entry as { texture: Texture }).texture = texture;
  tiles.set(file, entry);
  return entry;
}

/** The tiles a material needs, loading any that are not cached yet. */
export function hullMaps(definition: MaterialDefinition): HullMaps {
  return {
    map: definition.texture ? hullTexture(definition.texture).texture : null,
    glow: definition.glow ? hullTexture(definition.glow.mask).texture : null,
  };
}

export function hullMapsLoaded(definition: MaterialDefinition): boolean {
  const files = materialFiles(definition);
  return files.every((file) => tiles.get(file)?.loaded ?? false);
}

/** Resolves once every tile the material needs has been tried; check `hullMapsLoaded` for success. */
export function hullMapsReady(definition: MaterialDefinition): Promise<void> {
  return Promise.all(materialFiles(definition).map((file) => hullTexture(file).ready)).then(() => undefined);
}

function materialFiles(definition: MaterialDefinition): string[] {
  const files: string[] = [];
  if (definition.texture) files.push(definition.texture);
  if (definition.glow) files.push(definition.glow.mask);
  return files;
}

let neutral: DataTexture | null = null;
let black: DataTexture | null = null;

/** A 1×1 mid-grey tile: an overlay that changes nothing. */
function neutralTile(): DataTexture {
  if (!neutral) {
    neutral = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    neutral.colorSpace = NoColorSpace;
    neutral.needsUpdate = true;
  }
  return neutral;
}

/** A 1×1 black tile: a glow mask that never glows. */
function blackTile(): DataTexture {
  if (!black) {
    black = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.colorSpace = NoColorSpace;
    black.needsUpdate = true;
  }
  return black;
}
