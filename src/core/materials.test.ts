import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL_ID, HULL_MATERIALS, isMaterialId, materialAssetPath, materialFor, parseMaterialDefinition } from './materials';

describe('hull materials', () => {
  it('has unique ids, a plain default with no tile, and the three finishes', () => {
    expect(new Set(HULL_MATERIALS.map((material) => material.id)).size).toBe(HULL_MATERIALS.length);
    expect(materialFor(DEFAULT_MATERIAL_ID).texture).toBeNull();
    expect(HULL_MATERIALS.map((material) => material.id)).toEqual(expect.arrayContaining(['stone', 'obsidian', 'lava']));
  });

  it('ships every tile it refers to', () => {
    const shipped = Object.keys(import.meta.glob('/public/assets/materials/*.png'));
    for (const material of HULL_MATERIALS) {
      for (const file of [material.texture, material.glow?.mask]) {
        if (!file) continue;
        expect(shipped, file).toContain(`/public/${materialAssetPath(file)}`);
      }
      expect(material.scale).toBeGreaterThan(0);
    }
  });

  it('lava moves and glows; stone does neither', () => {
    const lava = materialFor('lava');
    expect(lava.scroll.some((v) => v !== 0)).toBe(true);
    expect(lava.glow?.intensity).toBeGreaterThan(0);
    const stone = materialFor('stone');
    expect(stone.scroll).toEqual([0, 0]);
    expect(stone.glow).toBeNull();
  });

  it('falls back to plain for unknown ids', () => {
    expect(materialFor('granite').id).toBe('plain');
    expect(materialFor(undefined).id).toBe('plain');
    expect(isMaterialId('lava')).toBe(true);
    expect(isMaterialId('granite')).toBe(false);
    expect(isMaterialId(3)).toBe(false);
  });

  it('parses definitions from JSON and rejects bad ones', () => {
    const parsed = parseMaterialDefinition({ id: 'ice', texture: 'ice.png', scale: 4, glow: { mask: 'ice-glow.png', colour: '#88ddff', intensity: 0.5 } });
    expect(parsed).toMatchObject({ id: 'ice', name: 'ice', scale: 4, scroll: [0, 0], roles: ['main'], glow: { pulse: 0, drift: 0, intensity: 0.5 } });
    expect(parseMaterialDefinition({ id: 'bare' })).toMatchObject({ texture: null, roles: [], glow: null });
    expect(() => parseMaterialDefinition({ id: 'x', scale: 0 })).toThrow(/scale/);
    expect(() => parseMaterialDefinition({ id: 'x', roles: ['hull'] })).toThrow(/roles/);
    expect(() => parseMaterialDefinition({ id: 'x', glow: { mask: 'm.png', colour: 'red' } })).toThrow(/colour/);
    expect(() => parseMaterialDefinition({ id: 'x', scroll: [1] })).toThrow(/scroll/);
    expect(() => parseMaterialDefinition({ name: 'nameless' })).toThrow(/id/);
  });
});
