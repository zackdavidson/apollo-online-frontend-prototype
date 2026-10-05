import { FrontSide, MeshBasicMaterial, type IUniform } from 'three';

export interface GlowUniforms {
  readonly uTime: IUniform<number>;
  /** 0 idle, 1 full thrust, above 1 for boost. */
  readonly uThrottle: IUniform<number>;
}

export interface GlowMaterialHandle {
  readonly material: MeshBasicMaterial;
  readonly uniforms: GlowUniforms;
}

/**
 * Unlit, translucent material for glow and plume triangles. Plume vertices
 * carry a `plume` attribute (extent vector + fraction along it) and are
 * stretched along that vector by throttle, with a per-plume flicker, so the
 * jets animate without any CPU work per frame.
 */
export function createGlowMaterial(): GlowMaterialHandle {
  const uniforms: GlowUniforms = { uTime: { value: 0 }, uThrottle: { value: 0.7 } };
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    side: FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = uniforms.uTime;
    shader.uniforms['uThrottle'] = uniforms.uThrottle;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 plume;
uniform float uTime;
uniform float uThrottle;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 plumeBase = position - plume.xyz * plume.w;
float plumePhase = dot(plumeBase, vec3(12.9898, 78.233, 37.719));
float plumeFlicker = 0.9 + 0.1 * sin(uTime * 31.0 + plumePhase) + 0.06 * sin(uTime * 53.0 + plumePhase * 1.7);
float plumeScale = mix(0.3, 1.2, clamp(uThrottle, 0.0, 1.6)) * plumeFlicker;
transformed += plume.xyz * plume.w * (plumeScale - 1.0);`,
      );
  };
  material.customProgramCacheKey = () => 'ship-glow-plume';
  return { material, uniforms };
}
