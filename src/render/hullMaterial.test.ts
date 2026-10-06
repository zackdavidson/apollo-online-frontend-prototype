import type { WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { materialFor } from '../core/materials';
import { applyHullMaterial, createHullMaterial } from './hullMaterial';

describe('hull material shader', () => {
  it('splices the triplanar overlay into the standard shader and registers its uniforms', () => {
    const { material, uniforms } = createHullMaterial();
    const shader = {
      vertexShader: '#include <common>\n#include <begin_vertex>\n',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <emissivemap_fragment>\n',
      uniforms: {} as Record<string, unknown>,
    };
    material.onBeforeCompile(shader as unknown as Parameters<typeof material.onBeforeCompile>[0], {} as WebGLRenderer);
    expect(shader.vertexShader).toContain('vHullPos = position');
    expect(shader.fragmentShader).toContain('hullTriplanar(uHullMap');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uHullGlow');
    expect(shader.fragmentShader).toContain('#include <color_fragment>');
    expect(shader.uniforms['uHullTime']).toBe(uniforms.uHullTime);
  });

  it('keeps the hull plain until the tiles have loaded, then covers only the configured roles', () => {
    const { uniforms } = createHullMaterial();
    const lava = materialFor('lava');
    applyHullMaterial(uniforms, lava, { map: null, glow: null }, false);
    expect(uniforms.uHullStrength.value).toBe(0);
    applyHullMaterial(uniforms, lava, { map: null, glow: null }, true);
    expect(uniforms.uHullStrength.value).toBe(1);
    expect(uniforms.uHullRoles.value.toArray()).toEqual([1, 0, 0, 0]);
    expect(uniforms.uHullScroll.value.toArray()).toEqual([...lava.scroll]);
    expect(uniforms.uHullScale.value).toBe(lava.scale);
    expect(uniforms.uHullGlow.value.length()).toBeGreaterThan(0);
    expect(uniforms.uHullDrift.value).toBe(lava.glow?.drift);
    expect(uniforms.uHullPulse.value).toBe(lava.glow?.pulse);
    applyHullMaterial(uniforms, materialFor('plain'), { map: null, glow: null }, true);
    expect(uniforms.uHullStrength.value).toBe(0);
    expect(uniforms.uHullGlow.value.length()).toBe(0);
  });
});
