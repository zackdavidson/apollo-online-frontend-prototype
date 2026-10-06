import { describe, expect, it } from 'vitest';
import { parseMapDefinition, provingGroundMapDefinition } from '../game/map';
import { STAR_PRESETS, addCluster, addMarker, addNebula, addObject, addPlanet, addRock, addStarLayer, blankMap, deleteSelection, fromJson, hitTest, moveSelection, nextId, patchSelection, patchStarLayer, placeBand, placeSun, removeStarLayer, selectionLabel, setMapSettings, setSpawn, setStarLayers, toJson } from './mapDocument';

describe('map editor document', () => {
  it('places rocks, objects, markers and planets with fresh ids, clamped to the map', () => {
    let map = blankMap('Test', 1000);
    const rock = addRock(map, 100, 200, { kind: 'iron', radius: 4, respawn: 60 });
    map = rock.map;
    expect(rock.selection).toEqual({ kind: 'rock', index: 0 });
    expect(map.rocks[0]).toMatchObject({ id: 'rock-0001', x: 100, y: 200, kind: 'iron', radius: 4, respawn: 60 });
    map = addRock(map, -50, 5000).map;
    expect(map.rocks[1]).toMatchObject({ id: 'rock-0002', x: 0, y: 1000 });
    map = addObject(map, 'gas-cloud', 300, 300).map;
    map = addObject(map, 'beacon', 400, 300).map;
    map = addObject(map, 'cache', 500, 300).map;
    expect(map.objects.map((o) => o.type)).toEqual(['gas-cloud', 'beacon', 'cache']);
    expect(map.objects[0]).toMatchObject({ id: 'gas-0001', radius: 60 });
    expect(map.objects[1]).toMatchObject({ id: 'beacon-0001', label: 'Beacon' });
    map = addMarker(map, 'icon', 10, 10, 'skull').map;
    map = addMarker(map, 'label', 20, 20).map;
    expect(map.markers[0]).toMatchObject({ type: 'icon', icon: 'skull', onMinimap: true });
    expect(map.markers[1]).toMatchObject({ type: 'label', text: 'Label', onMinimap: false });
    map = addPlanet(map, 800, 800, 'planet-gas-01').map;
    expect(map.scenery.planets[0]).toMatchObject({ art: 'planet-gas-01', x: 800, y: 800 });
    expect(() => parseMapDefinition(JSON.parse(toJson(map)))).not.toThrow();
  });

  it('skips ids that are already taken', () => {
    expect(nextId(['rock-0001', 'rock-0003'], 'rock')).toBe('rock-0002');
    expect(nextId([], 'gas')).toBe('gas-0001');
  });

  it('moves, patches and deletes the selection, but never deletes the spawn', () => {
    let map = addRock(blankMap('Test', 1000), 100, 100).map;
    map = moveSelection(map, { kind: 'rock', index: 0 }, 250.123, 1500);
    expect(map.rocks[0]).toMatchObject({ x: 250.12, y: 1000 });
    map = patchSelection(map, { kind: 'rock', index: 0 }, { kind: 'crystal', respawn: null });
    expect(map.rocks[0]).toMatchObject({ kind: 'crystal', respawn: null });
    map = setSpawn(map, 10, 20, 1.5);
    expect(map.spawn).toEqual({ x: 10, y: 20, heading: 1.5 });
    expect(deleteSelection(map, { kind: 'spawn' })).toBe(map);
    map = deleteSelection(map, { kind: 'rock', index: 0 });
    expect(map.rocks).toHaveLength(0);
  });

  it('hit-tests small things before big ones and respects the tolerance', () => {
    let map = blankMap('Test', 1000);
    map = addObject(map, 'gas-cloud', 500, 500).map; // radius 60
    map = addObject(map, 'cache', 510, 505).map;
    map = addRock(map, 540, 500, { kind: 'stone', radius: 3, respawn: null }).map;
    expect(hitTest(map, 510, 505, 2)).toEqual({ kind: 'object', index: 1 });
    expect(hitTest(map, 541, 501, 2)).toEqual({ kind: 'rock', index: 0 });
    expect(hitTest(map, 470, 470, 2)).toEqual({ kind: 'object', index: 0 });
    expect(hitTest(map, 900, 900, 2)).toBeNull();
    expect(hitTest(map, 502, 498, 5)).toEqual({ kind: 'spawn' });
  });

  it('scatters a cluster with unique ids inside the map', () => {
    const base = addRock(blankMap('Test', 1000), 100, 100).map;
    const { map, added } = addCluster(base, 500, 500, { count: 20, radius: 50, kind: 'ice', crystalChance: 0, respawn: 30 });
    expect(added).toBeGreaterThan(5);
    expect(map.rocks).toHaveLength(1 + added);
    expect(new Set(map.rocks.map((r) => r.id)).size).toBe(map.rocks.length);
    for (const rock of map.rocks.slice(1)) {
      expect(Math.hypot(rock.x - 500, rock.y - 500)).toBeLessThan(80);
      expect(rock.respawn).toBe(30);
    }
  });

  it('round-trips through JSON and reports parse errors with their path', () => {
    const map = setMapSettings(provingGroundMapDefinition(), { name: 'Edited', seed: 3 });
    const back = fromJson(toJson(map));
    expect(back.ok && back.map).toEqual(map);
    const bad = fromJson('{"size": 50}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/map\.size/);
    expect(fromJson('not json').ok).toBe(false);
  });

  it('places and moves backdrop art without clamping it to the map, with one sun and one band', () => {
    let map = blankMap('Test', 1000);
    const nebula = addNebula(map, -2000, 3000, 'nebula-03', '#8c2a5a');
    map = nebula.map;
    expect(nebula.selection).toEqual({ kind: 'nebula', index: 0 });
    expect(map.scenery.nebulae[0]).toMatchObject({ art: 'nebula-03', x: -2000, y: 3000, tint: '#8c2a5a', size: 6000 });
    map = placeSun(map, 1500, 1500).map;
    map = placeSun(map, 1600, 1500).map;
    expect(map.scenery.sun).toMatchObject({ x: 1600, y: 1500, size: 6000 });
    map = placeBand(map, 500, 800).map;
    expect(map.scenery.band).toMatchObject({ art: 'nebula-02', x: 500, y: 800, width: 30000 });
    map = moveSelection(map, { kind: 'nebula', index: 0 }, -5000, 9000);
    expect(map.scenery.nebulae[0]).toMatchObject({ x: -5000, y: 9000 });
    map = patchSelection(map, { kind: 'sun' }, { size: 4000 });
    expect(map.scenery.sun?.size).toBe(4000);
    expect(selectionLabel(map, { kind: 'band' })).toBe('Galactic band');
    map = deleteSelection(map, { kind: 'sun' });
    map = deleteSelection(map, { kind: 'band' });
    map = deleteSelection(map, { kind: 'nebula', index: 0 });
    expect(map.scenery.sun).toBeNull();
    expect(map.scenery.band).toBeNull();
    expect(map.scenery.nebulae).toHaveLength(0);
    expect(() => parseMapDefinition(JSON.parse(toJson(map)))).not.toThrow();
  });

  it('edits star layers and applies presets', () => {
    let map = blankMap('Test', 1000);
    const initial = map.scenery.stars.length;
    map = addStarLayer(map);
    expect(map.scenery.stars).toHaveLength(initial + 1);
    map = patchStarLayer(map, initial, { kind: 'clusters', clusters: 5, count: 300 });
    expect(map.scenery.stars[initial]).toMatchObject({ kind: 'clusters', clusters: 5, count: 300 });
    map = removeStarLayer(map, 0);
    expect(map.scenery.stars).toHaveLength(initial);
    const none = STAR_PRESETS.find((preset) => preset.id === 'none')!;
    map = setStarLayers(map, none.layers);
    expect(map.scenery.stars).toHaveLength(0);
    const sparse = STAR_PRESETS.find((preset) => preset.id === 'sparse')!;
    expect(sparse.layers[0]!.count).toBeLessThan(STAR_PRESETS[0]!.layers[0]!.count);
    expect(() => parseMapDefinition(JSON.parse(toJson(setStarLayers(map, sparse.layers))))).not.toThrow();
  });
});
