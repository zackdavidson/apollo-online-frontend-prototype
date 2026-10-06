import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { MAP_ICON_NAMES, defaultMapDefinition, provingGroundMapDefinition, type MapDefinition, type MapIconName, type StarLayerSpec } from '../game/map';
import { ROCK_KINDS, type RockKind } from '../game/rocks';
import type { ShipVisualSpec } from '../scene/shipActor';
import { MOON_ART, PLANET_ART } from '../scene/spaceAssets';
import { History } from './history';
import { MapCanvas } from './MapCanvas';
import { MapScene } from './MapScene';
import {
  DEFAULT_CLUSTER_OPTIONS,
  DEFAULT_ROCK_OPTIONS,
  NEBULA_ART_NAMES,
  NEBULA_TINTS,
  RESOURCE_OPTIONS,
  STAR_PRESETS,
  addCluster,
  addMarker,
  addNebula,
  addObject,
  addPlanet,
  addRock,
  addStarLayer,
  blankMap,
  deleteSelection,
  fromJson,
  moveSelection,
  patchSelection,
  patchStarLayer,
  placeBand,
  placeSun,
  removeStarLayer,
  selectionLabel,
  setCometEnabled,
  setMapSettings,
  setSpawn,
  setStarLayers,
  summarize,
  toJson,
  type ClusterOptions,
  type Point,
  type RockOptions,
  type Selection,
} from './mapDocument';

export interface MapEditorProps {
  readonly initial: MapDefinition;
  /** The player's ship, shown parked at the spawn. */
  readonly ship?: ShipVisualSpec;
  /** Fly the map as it stands. */
  readonly onFly: (map: MapDefinition) => void;
  /** Back to the hangar with the map as the next one to fly. */
  readonly onClose: (map: MapDefinition) => void;
}

type Tool = 'select' | 'rock' | 'cluster' | 'cache' | 'beacon' | 'gas' | 'icon' | 'label' | 'planet' | 'nebula' | 'sun' | 'band' | 'spawn';

const TOOLS: ReadonlyArray<{ readonly id: Tool; readonly glyph: string; readonly name: string; readonly key: string }> = [
  { id: 'select', glyph: '↖', name: 'Select and move', key: 'V' },
  { id: 'rock', glyph: '●', name: 'Rock', key: 'R' },
  { id: 'cluster', glyph: '⁂', name: 'Rock cluster', key: 'K' },
  { id: 'cache', glyph: '◆', name: 'Cache', key: 'C' },
  { id: 'beacon', glyph: '◎', name: 'Beacon', key: 'B' },
  { id: 'gas', glyph: '☁', name: 'Gas cloud', key: 'G' },
  { id: 'icon', glyph: '⚑', name: 'Icon marker', key: 'I' },
  { id: 'label', glyph: 'T', name: 'Label', key: 'L' },
  { id: 'planet', glyph: '◍', name: 'Planet', key: 'P' },
  { id: 'nebula', glyph: '✺', name: 'Nebula', key: 'N' },
  { id: 'sun', glyph: '☀', name: 'Sun (one per map)', key: 'U' },
  { id: 'band', glyph: '≋', name: 'Galactic band (one per map)', key: 'H' },
  { id: 'spawn', glyph: '⌂', name: 'Spawn point', key: 'S' },
];

const ROCK_KIND_NAMES = Object.keys(ROCK_KINDS) as RockKind[];
const PLANET_ART_NAMES = [...PLANET_ART, ...MOON_ART].map((art) => art.file.replace(/\.png$/, ''));

/** The map editor: a canvas in the middle, tools on the left, properties and JSON on the right. */
export function MapEditor({ initial, ship, onFly, onClose }: MapEditorProps) {
  const historyRef = useRef<History<MapDefinition> | null>(null);
  if (!historyRef.current) historyRef.current = new History(initial);
  const history = historyRef.current;

  const [map, setMap] = useState(initial);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [rockOptions, setRockOptions] = useState<RockOptions>(DEFAULT_ROCK_OPTIONS);
  const [clusterOptions, setClusterOptions] = useState<ClusterOptions>(DEFAULT_CLUSTER_OPTIONS);
  const [iconName, setIconName] = useState<MapIconName>('flag');
  const [planetArt, setPlanetArt] = useState(PLANET_ART_NAMES[0] ?? 'planet-gas-01');
  const [nebulaArt, setNebulaArt] = useState(NEBULA_ART_NAMES[0] ?? 'nebula-01');
  const [nebulaTint, setNebulaTint] = useState(NEBULA_TINTS[0] ?? '#6a3fb0');
  const [bandArt, setBandArt] = useState('nebula-02');
  const [hover, setHover] = useState<Point | null>(null);
  const [view, setView] = useState<Point | null>(null);
  const [jump, setJump] = useState<Point | null>(null);
  const [jsonText, setJsonText] = useState(() => toJson(initial));
  const [jsonDirty, setJsonDirty] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const dragFrom = useRef<MapDefinition | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const commit = (next: MapDefinition): void => setMap(history.push(next));
  const amend = (next: MapDefinition): void => setMap(history.replace(next));
  /** Replace the whole document (a load): clears the selection and the JSON draft. */
  const replaceDocument = (next: MapDefinition, what: string): void => {
    commit(next);
    setSelection(null);
    setJsonDirty(false);
    setJsonError(null);
    setNotice(what);
  };

  useEffect(() => {
    if (!jsonDirty) setJsonText(toJson(map));
  }, [map, jsonDirty]);

  const undo = (): void => {
    const previous = history.undo();
    if (previous) {
      setMap(previous);
      setSelection(null);
    }
  };
  const redo = (): void => {
    const next = history.redo();
    if (next) {
      setMap(next);
      setSelection(null);
    }
  };
  const removeSelection = (): void => {
    if (!selection || selection.kind === 'spawn') return;
    commit(deleteSelection(history.present, selection));
    setSelection(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && event.code === 'KeyY') {
        event.preventDefault();
        redo();
        return;
      }
      if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault();
        removeSelection();
        return;
      }
      if (event.code === 'Escape') {
        setTool('select');
        setSelection(null);
        return;
      }
      const hotkey = TOOLS.find((candidate) => event.code === `Key${candidate.key}`);
      if (hotkey && !meta) setTool(hotkey.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const place = (x: number, y: number): void => {
    const current = history.present;
    switch (tool) {
      case 'select':
        return;
      case 'rock': {
        const placed = addRock(current, x, y, rockOptions);
        commit(placed.map);
        setSelection(placed.selection);
        return;
      }
      case 'cluster': {
        const result = addCluster(current, x, y, clusterOptions);
        commit(result.map);
        setSelection(null);
        setNotice(`Scattered ${result.added} rocks.`);
        return;
      }
      case 'cache':
      case 'beacon': {
        const placed = addObject(current, tool, x, y);
        commit(placed.map);
        setSelection(placed.selection);
        return;
      }
      case 'gas': {
        const placed = addObject(current, 'gas-cloud', x, y);
        commit(placed.map);
        setSelection(placed.selection);
        return;
      }
      case 'icon':
      case 'label': {
        const placed = addMarker(current, tool, x, y, iconName);
        commit(placed.map);
        setSelection(placed.selection);
        return;
      }
      case 'planet': {
        const placed = addPlanet(current, x, y, planetArt);
        commit(placed.map);
        setSelection(placed.selection);
        return;
      }
      case 'nebula': {
        const placed = addNebula(current, x, y, nebulaArt, nebulaTint);
        commit(placed.map);
        setSelection(placed.selection);
        return;
      }
      case 'sun': {
        const placed = placeSun(current, x, y);
        commit(placed.map);
        setSelection(placed.selection);
        return;
      }
      case 'band': {
        const placed = placeBand(current, x, y, bandArt);
        commit(placed.map);
        setSelection(placed.selection);
        return;
      }
      case 'spawn':
        commit(setSpawn(current, x, y));
        setSelection({ kind: 'spawn' });
        return;
    }
  };

  const applyJson = (): void => {
    const result = fromJson(jsonText);
    if (!result.ok) {
      setJsonError(result.error);
      return;
    }
    replaceDocument(result.map, 'Applied JSON.');
  };

  const download = (): void => {
    const blob = new Blob([toJson(map)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${map.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(toJson(map));
      setNotice('JSON copied to the clipboard.');
    } catch {
      setNotice('Could not copy; select the JSON text and copy it by hand.');
    }
  };

  const loadFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = fromJson(await file.text());
    if (!result.ok) {
      setJsonError(`${file.name}: ${result.error}`);
      return;
    }
    replaceDocument(result.map, `Loaded ${file.name}.`);
  };

  const counts = summarize(map);

  return (
    <div className="map-editor">
      <header className="map-editor-head">
        <h1>Map editor</h1>
        <input value={map.name} onChange={(event) => commit(setMapSettings(history.present, { name: event.target.value }))} title="Map name" />
        <span className="muted">
          {map.size} × {map.size}
        </span>
        <span className="spacer" />
        <button type="button" onClick={undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <button type="button" className="primary" onClick={() => onFly(map)}>
          Fly this map
        </button>
        <button type="button" onClick={() => onClose(map)}>
          Done
        </button>
      </header>

      <nav className="map-editor-tools">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`map-editor-tool${tool === entry.id ? ' active' : ''}`}
            title={`${entry.name} (${entry.key})`}
            data-tool={entry.id}
            onClick={() => setTool(entry.id)}
          >
            {entry.glyph}
            <small>{entry.key}</small>
          </button>
        ))}
      </nav>

      <div className="map-editor-canvas-wrap">
        <MapScene
          map={map}
          selection={selection}
          selecting={tool === 'select'}
          ship={ship ?? null}
          jump={jump}
          onViewChange={setView}
          onPlace={place}
          onSelect={setSelection}
          onDragStart={() => {
            dragFrom.current = history.present;
          }}
          onDrag={(dragged, x, y) => amend(moveSelection(history.present, dragged, x, y))}
          onDragEnd={() => {
            const from = dragFrom.current;
            dragFrom.current = null;
            if (!from) return;
            const final = history.present;
            if (final === from) return;
            history.replace(from);
            commit(final);
          }}
          onHover={setHover}
        />
      </div>

      <aside className="map-editor-side">
        <div className="map-editor-overview" title="Overview · click to look there">
          <MapCanvas
            map={map}
            selection={selection}
            selecting
            mode="overview"
            focus={view}
            onJump={(point) => setJump({ x: point.x, y: point.y })}
            onPlace={() => undefined}
            onSelect={() => undefined}
            onDragStart={() => undefined}
            onDrag={() => undefined}
            onDragEnd={() => undefined}
            onHover={() => undefined}
          />
        </div>
        <ToolOptions
          tool={tool}
          rock={rockOptions}
          onRock={setRockOptions}
          cluster={clusterOptions}
          onCluster={setClusterOptions}
          icon={iconName}
          onIcon={setIconName}
          planetArt={planetArt}
          onPlanetArt={setPlanetArt}
          nebulaArt={nebulaArt}
          onNebulaArt={setNebulaArt}
          nebulaTint={nebulaTint}
          onNebulaTint={setNebulaTint}
          bandArt={bandArt}
          onBandArt={setBandArt}
        />

        <h2>{selection ? selectionLabel(map, selection) : 'Nothing selected'}</h2>
        {selection ? (
          <SelectionFields map={map} selection={selection} onPatch={(patch) => commit(patchSelection(history.present, selection, patch))} onDelete={removeSelection} />
        ) : (
          <p className="muted">Pick the select tool and click something on the map, or choose a tool and click to place.</p>
        )}

        <SceneryList map={map} selection={selection} onSelect={setSelection} />

        <h2>Stars</h2>
        <StarsEditor
          map={map}
          onLayers={(stars) => commit(setStarLayers(history.present, stars))}
          onAdd={() => commit(addStarLayer(history.present))}
          onPatch={(index, patch) => commit(patchStarLayer(history.present, index, patch))}
          onRemove={(index) => commit(removeStarLayer(history.present, index))}
        />

        <h2>Map</h2>
        <NumberField label="Size" value={map.size} min={500} step={100} onChange={(size) => commit(setMapSettings(history.present, { size: Math.max(500, size) }))} />
        <NumberField label="Seed" value={map.seed} step={1} onChange={(seed) => commit(setMapSettings(history.present, { seed: Math.round(seed) }))} />
        <CheckField label="Comet" checked={map.comet.enabled} onChange={(enabled) => commit(setCometEnabled(history.present, enabled))} />
        <div className="ed-inline">
          <button type="button" onClick={() => replaceDocument(blankMap('New Map', 1000), 'New blank map.')}>
            New
          </button>
          <button type="button" onClick={() => replaceDocument(provingGroundMapDefinition(), 'Loaded the Proving Ground.')}>
            Proving Ground
          </button>
          <button type="button" onClick={() => replaceDocument(defaultMapDefinition(), 'Loaded the Starter Sector.')}>
            Starter Sector
          </button>
        </div>

        <h2>JSON</h2>
        <div className="ed-inline">
          <button type="button" onClick={() => void copy()}>
            Copy
          </button>
          <button type="button" onClick={download}>
            Download
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Load file…
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(event) => void loadFile(event)} />
        </div>
        <textarea
          className={jsonDirty ? 'dirty' : ''}
          value={jsonText}
          spellCheck={false}
          onChange={(event) => {
            setJsonText(event.target.value);
            setJsonDirty(true);
            setJsonError(null);
          }}
        />
        <div className="ed-inline">
          <button type="button" className="primary" onClick={applyJson} disabled={!jsonDirty}>
            Apply JSON
          </button>
          <button
            type="button"
            onClick={() => {
              setJsonDirty(false);
              setJsonError(null);
            }}
            disabled={!jsonDirty}
          >
            Revert
          </button>
        </div>
        {jsonError ? <div className="ed-error">{jsonError}</div> : null}
        <p className="muted">Paste a map here and apply it, or edit what the panel does not cover (comet tuning).</p>
      </aside>

      <footer className="map-editor-status">
        <span>
          cursor <b>{hover ? `${hover.x.toFixed(0)}, ${hover.y.toFixed(0)}` : '–'}</b>
        </span>
        <span>
          rocks <b>{counts.rocks}</b> · objects <b>{counts.objects}</b> · markers <b>{counts.markers}</b> · planets <b>{counts.planets}</b> · nebulae <b>{counts.nebulae}</b>
        </span>
        <span>left-click places or selects · drag moves · wheel zooms · right-drag pans · Q/E tilt · C camera · Delete removes · Ctrl+Z undoes</span>
        <span className="spacer" />
        <span>{notice}</span>
      </footer>
    </div>
  );
}

// ---- panels ------------------------------------------------------------------

interface ToolOptionsProps {
  readonly tool: Tool;
  readonly rock: RockOptions;
  readonly onRock: (options: RockOptions) => void;
  readonly cluster: ClusterOptions;
  readonly onCluster: (options: ClusterOptions) => void;
  readonly icon: MapIconName;
  readonly onIcon: (icon: MapIconName) => void;
  readonly planetArt: string;
  readonly onPlanetArt: (art: string) => void;
  readonly nebulaArt: string;
  readonly onNebulaArt: (art: string) => void;
  readonly nebulaTint: string;
  readonly onNebulaTint: (tint: string) => void;
  readonly bandArt: string;
  readonly onBandArt: (art: string) => void;
}

/** Defaults for the next thing the active tool places. */
function ToolOptions({ tool, rock, onRock, cluster, onCluster, icon, onIcon, planetArt, onPlanetArt, nebulaArt, onNebulaArt, nebulaTint, onNebulaTint, bandArt, onBandArt }: ToolOptionsProps) {
  switch (tool) {
    case 'nebula':
      return (
        <>
          <h2>New nebula</h2>
          <SelectField label="Art" value={nebulaArt} options={NEBULA_ART_NAMES} onChange={onNebulaArt} />
          <ColourField label="Tint" value={nebulaTint} onChange={onNebulaTint} />
          <div className="ed-inline">
            {NEBULA_TINTS.map((tint) => (
              <button key={tint} type="button" className="ed-swatch" style={{ background: tint }} title={tint} onClick={() => onNebulaTint(tint)} />
            ))}
          </div>
          <p className="muted">Click anywhere, on or off the map; nebulae sit 6000 units below the ship plane and drift with parallax.</p>
        </>
      );
    case 'sun':
      return (
        <>
          <h2>Sun</h2>
          <p className="muted">Click to put the sun there (or move it). One per map.</p>
        </>
      );
    case 'band':
      return (
        <>
          <h2>Galactic band</h2>
          <SelectField label="Art" value={bandArt} options={NEBULA_ART_NAMES} onChange={onBandArt} />
          <p className="muted">Click to lay the band through that point (or move it). One per map.</p>
        </>
      );
    case 'rock':
      return (
        <>
          <h2>New rock</h2>
          <SelectField label="Kind" value={rock.kind} options={ROCK_KIND_NAMES} onChange={(kind) => onRock({ ...rock, kind: kind as RockKind })} />
          <NumberField label="Radius" value={rock.radius} min={0.5} step={0.5} onChange={(radius) => onRock({ ...rock, radius })} />
          <RespawnField value={rock.respawn} onChange={(respawn) => onRock({ ...rock, respawn })} />
        </>
      );
    case 'cluster':
      return (
        <>
          <h2>New cluster</h2>
          <SelectField label="Kind" value={cluster.kind} options={ROCK_KIND_NAMES} onChange={(kind) => onCluster({ ...cluster, kind: kind as RockKind })} />
          <NumberField label="Rocks" value={cluster.count} min={1} step={1} onChange={(count) => onCluster({ ...cluster, count: Math.max(1, Math.round(count)) })} />
          <NumberField label="Spread" value={cluster.radius} min={5} step={5} onChange={(radius) => onCluster({ ...cluster, radius })} />
          <NumberField label="Crystal odds" value={cluster.crystalChance} min={0} max={1} step={0.05} onChange={(crystalChance) => onCluster({ ...cluster, crystalChance })} />
          <RespawnField value={cluster.respawn} onChange={(respawn) => onCluster({ ...cluster, respawn })} />
        </>
      );
    case 'icon':
      return (
        <>
          <h2>New icon</h2>
          <SelectField label="Icon" value={icon} options={MAP_ICON_NAMES} onChange={(name) => onIcon(name as MapIconName)} />
        </>
      );
    case 'planet':
      return (
        <>
          <h2>New planet</h2>
          <SelectField label="Art" value={planetArt} options={PLANET_ART_NAMES} onChange={onPlanetArt} />
        </>
      );
    default:
      return null;
  }
}

interface SelectionFieldsProps {
  readonly map: MapDefinition;
  readonly selection: Selection;
  readonly onPatch: (patch: Record<string, unknown>) => void;
  readonly onDelete: () => void;
}

/** Every field of the selected thing, as inputs. */
function SelectionFields({ map, selection, onPatch, onDelete }: SelectionFieldsProps) {
  const position = (x: number, y: number) => (
    <>
      <NumberField label="X" value={x} step={1} onChange={(value) => onPatch({ x: value })} />
      <NumberField label="Y" value={y} step={1} onChange={(value) => onPatch({ y: value })} />
    </>
  );
  const remove = (
    <div className="ed-inline">
      <button type="button" onClick={onDelete}>
        Delete (Del)
      </button>
    </div>
  );
  switch (selection.kind) {
    case 'spawn':
      return (
        <>
          {position(map.spawn.x, map.spawn.y)}
          <NumberField label="Heading" value={map.spawn.heading} step={0.1} onChange={(heading) => onPatch({ heading })} />
        </>
      );
    case 'rock': {
      const rock = map.rocks[selection.index];
      if (!rock) return null;
      return (
        <>
          <TextField label="Id" value={rock.id} onChange={(id) => onPatch({ id })} />
          <SelectField label="Kind" value={rock.kind} options={ROCK_KIND_NAMES} onChange={(kind) => onPatch({ kind })} />
          <NumberField label="Radius" value={rock.radius} min={0.5} step={0.5} onChange={(radius) => onPatch({ radius })} />
          <RespawnField value={rock.respawn} onChange={(respawn) => onPatch({ respawn })} />
          {position(rock.x, rock.y)}
          {remove}
        </>
      );
    }
    case 'object': {
      const object = map.objects[selection.index];
      if (!object) return null;
      if (object.type === 'cache') {
        return (
          <>
            <SelectField label="Resource" value={object.resource} options={RESOURCE_OPTIONS} onChange={(resource) => onPatch({ resource })} />
            <NumberField label="Count" value={object.count} min={1} step={1} onChange={(count) => onPatch({ count: Math.max(1, Math.round(count)) })} />
            {position(object.x, object.y)}
            {remove}
          </>
        );
      }
      if (object.type === 'beacon') {
        return (
          <>
            <TextField label="Id" value={object.id} onChange={(id) => onPatch({ id })} />
            <TextField label="Label" value={object.label} onChange={(label) => onPatch({ label })} />
            <TextField label="Description" value={object.description} onChange={(description) => onPatch({ description })} />
            <ColourField label="Colour" value={object.colour} onChange={(colour) => onPatch({ colour })} />
            <NumberField label="Radius" value={object.radius} min={1} step={1} onChange={(radius) => onPatch({ radius })} />
            {position(object.x, object.y)}
            {remove}
          </>
        );
      }
      return (
        <>
          <TextField label="Id" value={object.id} onChange={(id) => onPatch({ id })} />
          <TextField label="Label" value={object.label} onChange={(label) => onPatch({ label })} />
          <ColourField label="Colour" value={object.colour} onChange={(colour) => onPatch({ colour })} />
          <NumberField label="Radius" value={object.radius} min={1} step={5} onChange={(radius) => onPatch({ radius })} />
          <NumberField label="Damage / s" value={object.damagePerSecond} min={0} step={1} onChange={(damagePerSecond) => onPatch({ damagePerSecond })} />
          {position(object.x, object.y)}
          {remove}
        </>
      );
    }
    case 'marker': {
      const marker = map.markers[selection.index];
      if (!marker) return null;
      if (marker.type === 'icon') {
        return (
          <>
            <SelectField label="Icon" value={marker.icon} options={MAP_ICON_NAMES} onChange={(icon) => onPatch({ icon })} />
            <TextField label="Label" value={marker.label} onChange={(label) => onPatch({ label })} />
            <label className="ed-field">
              <span>Colour</span>
              <span className="ed-inline">
                <input type="checkbox" checked={marker.colour !== null} onChange={(event) => onPatch({ colour: event.target.checked ? '#ffffff' : null })} title="Override the icon's own colours" />
                {marker.colour !== null ? <input type="color" value={marker.colour} onChange={(event) => onPatch({ colour: event.target.value })} /> : <span className="muted">own palette</span>}
              </span>
            </label>
            <CheckField label="On minimap" checked={marker.onMinimap} onChange={(onMinimap) => onPatch({ onMinimap })} />
            {position(marker.x, marker.y)}
            {remove}
          </>
        );
      }
      return (
        <>
          <TextField label="Text" value={marker.text} onChange={(text) => onPatch({ text })} />
          <ColourField label="Colour" value={marker.colour} onChange={(colour) => onPatch({ colour })} />
          <NumberField label="Size" value={marker.size} min={6} step={1} onChange={(size) => onPatch({ size })} />
          <CheckField label="On minimap" checked={marker.onMinimap} onChange={(onMinimap) => onPatch({ onMinimap })} />
          {position(marker.x, marker.y)}
          {remove}
        </>
      );
    }
    case 'planet': {
      const planet = map.scenery.planets[selection.index];
      if (!planet) return null;
      return (
        <>
          <SelectField label="Art" value={planet.art} options={PLANET_ART_NAMES} onChange={(art) => onPatch({ art })} />
          <NumberField label="Radius" value={planet.radius} min={1} step={10} onChange={(radius) => onPatch({ radius })} />
          <NumberField label="Depth" value={planet.depth} step={100} onChange={(depth) => onPatch({ depth })} />
          <NumberField label="Rotation" value={planet.rotation} step={0.1} onChange={(rotation) => onPatch({ rotation })} />
          {position(planet.x, planet.y)}
          {remove}
        </>
      );
    }
    case 'nebula': {
      const nebula = map.scenery.nebulae[selection.index];
      if (!nebula) return null;
      return (
        <>
          <SelectField label="Art" value={nebula.art} options={NEBULA_ART_NAMES} onChange={(art) => onPatch({ art })} />
          <ColourField label="Tint" value={nebula.tint} onChange={(tint) => onPatch({ tint })} />
          <NumberField label="Opacity" value={nebula.opacity} min={0} max={1} step={0.05} onChange={(opacity) => onPatch({ opacity })} />
          <NumberField label="Size" value={nebula.size} min={100} step={250} onChange={(size) => onPatch({ size })} />
          <NumberField label="Depth" value={nebula.depth} step={250} onChange={(depth) => onPatch({ depth })} />
          <NumberField label="Rotation" value={nebula.rotation} step={0.1} onChange={(rotation) => onPatch({ rotation })} />
          {position(nebula.x, nebula.y)}
          {remove}
        </>
      );
    }
    case 'sun': {
      const sun = map.scenery.sun;
      if (!sun) return null;
      return (
        <>
          <NumberField label="Size" value={sun.size} min={100} step={250} onChange={(size) => onPatch({ size })} />
          <NumberField label="Depth" value={sun.depth} step={250} onChange={(depth) => onPatch({ depth })} />
          {position(sun.x, sun.y)}
          {remove}
        </>
      );
    }
    case 'band': {
      const band = map.scenery.band;
      if (!band) return null;
      return (
        <>
          <SelectField label="Art" value={band.art} options={NEBULA_ART_NAMES} onChange={(art) => onPatch({ art })} />
          <ColourField label="Tint" value={band.tint} onChange={(tint) => onPatch({ tint })} />
          <NumberField label="Opacity" value={band.opacity} min={0} max={1} step={0.02} onChange={(opacity) => onPatch({ opacity })} />
          <NumberField label="Width" value={band.width} min={100} step={1000} onChange={(width) => onPatch({ width })} />
          <NumberField label="Height" value={band.height} min={100} step={250} onChange={(height) => onPatch({ height })} />
          <NumberField label="Depth" value={band.depth} step={250} onChange={(depth) => onPatch({ depth })} />
          <NumberField label="Rotation" value={band.rotation} step={0.05} onChange={(rotation) => onPatch({ rotation })} />
          {position(band.x, band.y)}
          {remove}
        </>
      );
    }
  }
}

/** Every piece of backdrop art, as a list to select from: the big sprites are easy to miss by clicking. */
function SceneryList({ map, selection, onSelect }: { map: MapDefinition; selection: Selection | null; onSelect: (selection: Selection) => void }) {
  const entries: Array<{ selection: Selection; text: string }> = [
    ...map.scenery.planets.map((planet, index) => ({ selection: { kind: 'planet', index } as Selection, text: `Planet · ${planet.art} · r ${planet.radius}` })),
    ...map.scenery.nebulae.map((nebula, index) => ({ selection: { kind: 'nebula', index } as Selection, text: `Nebula · ${nebula.art} · ${nebula.tint}` })),
    ...(map.scenery.sun ? [{ selection: { kind: 'sun' } as Selection, text: `Sun · size ${map.scenery.sun.size}` }] : []),
    ...(map.scenery.band ? [{ selection: { kind: 'band' } as Selection, text: `Galactic band · ${map.scenery.band.art}` }] : []),
  ];
  return (
    <>
      <h2>Scenery</h2>
      {entries.length === 0 ? <p className="muted">No backdrop art yet: use the planet, nebula, sun and band tools.</p> : null}
      <div className="ed-list">
        {entries.map((entry) => {
          const active = selection !== null && JSON.stringify(selection) === JSON.stringify(entry.selection);
          return (
            <button key={JSON.stringify(entry.selection)} type="button" className={`ed-row${active ? ' active' : ''}`} onClick={() => onSelect(entry.selection)}>
              {entry.text}
            </button>
          );
        })}
      </div>
    </>
  );
}

interface StarsEditorProps {
  readonly map: MapDefinition;
  readonly onLayers: (stars: readonly StarLayerSpec[]) => void;
  readonly onAdd: () => void;
  readonly onPatch: (index: number, patch: Partial<StarLayerSpec>) => void;
  readonly onRemove: (index: number) => void;
}

/** The star field: presets, then every layer's numbers. Deeper layers drift slower; tile is how far the pattern repeats. */
function StarsEditor({ map, onLayers, onAdd, onPatch, onRemove }: StarsEditorProps) {
  return (
    <>
      <div className="ed-inline">
        {STAR_PRESETS.map((preset) => (
          <button key={preset.id} type="button" onClick={() => onLayers(preset.layers)} title={`${preset.layers.length} layers`}>
            {preset.name}
          </button>
        ))}
        <button type="button" onClick={onAdd}>
          + Layer
        </button>
      </div>
      {map.scenery.stars.map((layer, index) => (
        <div key={index} className="ed-layer">
          <div className="ed-layer-head">
            <span>Layer {index + 1}</span>
            <button type="button" onClick={() => onRemove(index)} title="Remove this layer">
              ✕
            </button>
          </div>
          <SelectField label="Kind" value={layer.kind} options={['field', 'clusters']} onChange={(kind) => onPatch(index, { kind: kind as StarLayerSpec['kind'] })} />
          <NumberField label="Stars" value={layer.count} min={0} step={100} onChange={(count) => onPatch(index, { count: Math.max(0, Math.round(count)) })} />
          {layer.kind === 'clusters' ? <NumberField label="Clumps" value={layer.clusters ?? 5} min={1} step={1} onChange={(clusters) => onPatch(index, { clusters: Math.max(1, Math.round(clusters)) })} /> : null}
          <NumberField label="Depth" value={layer.depth} step={200} onChange={(depth) => onPatch(index, { depth })} />
          <NumberField label="Tile" value={layer.tile} min={500} step={500} onChange={(tile) => onPatch(index, { tile })} />
          <NumberField label="Brightness" value={layer.brightness} min={0} step={0.05} onChange={(brightness) => onPatch(index, { brightness })} />
          <NumberField label="Size (3D)" value={layer.sizeWorld} min={1} step={1} onChange={(sizeWorld) => onPatch(index, { sizeWorld })} />
          <NumberField label="Size (px)" value={layer.sizePx} min={0.5} step={0.2} onChange={(sizePx) => onPatch(index, { sizePx })} />
        </div>
      ))}
    </>
  );
}

// ---- fields ------------------------------------------------------------------

function NumberField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="ed-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="ed-field">
      <span>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <label className="ed-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="ed-field">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="ed-field">
      <span>{label}</span>
      <span className="ed-inline">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <code className="hex">{value}</code>
      </span>
    </label>
  );
}

/** Seconds until a rock returns, or never. */
function RespawnField({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="ed-field">
      <span>Respawn</span>
      <span className="ed-inline">
        <input type="checkbox" checked={value !== null} onChange={(event) => onChange(event.target.checked ? 120 : null)} title="Comes back after mining" />
        {value !== null ? (
          <input
            type="number"
            value={value}
            min={1}
            step={10}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(next);
            }}
          />
        ) : (
          <span className="muted">never</span>
        )}
      </span>
    </label>
  );
}
