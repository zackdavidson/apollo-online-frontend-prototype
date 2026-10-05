import './style.css';
import { createDefaultCatalog } from './catalog/catalog';
import { COLOUR_PRESETS } from './core/palette';
import type { SlotId } from './core/types';
import { decodeShipState, encodeShipState } from './state/serialization';
import {
  assembleFromState,
  createShipState,
  withAttachment,
  withColours,
  withHull,
  withRandomLoadout,
  type ShipState,
} from './state/shipState';
import { resolveParts } from './state/shipState';
import { Store } from './state/store';
import { FlightSession, type SessionShip } from './flight/flightSession';
import { type MapDefinition, MapParseError, type ResolvedMap, parseMapDefinition, provingGroundMapDefinition, resolveMap } from './game/map';
import { IdleController, TURRET_AI, TurretAi } from './game/controllers';
import type { DialogueLine } from './hud/interfaces';
import { fromMapCoords } from './game/mapCoords';
import { WEAPON_PROFILES, weaponProfileFor } from './game/weapons';
import { SceneView } from './render/sceneView';
import { BuilderPanel } from './ui/panel';

const catalog = createDefaultCatalog();
const firstHull = catalog.hulls[0];
if (!firstHull) throw new Error('Catalog has no hulls');

const viewport = document.getElementById('viewport');
const panelRoot = document.getElementById('panel');
const flightRoot = document.getElementById('flight');
if (!viewport || !panelRoot || !flightRoot) throw new Error('Missing #viewport, #panel or #flight in index.html');

const initialState = decodeShipState(window.location.hash.slice(1), catalog) ?? createShipState(firstHull);
const store = new Store<ShipState>(initialState);

const scene = new SceneView(
  viewport,
  {
    onSlotClick: (slotId) => {
      cycleSlot(slotId);
      panel.focusSlot(slotId);
    },
    onSlotHover: (slotId) => panel.setHoveredSlot(slotId),
  },
  initialState.colours,
);

const panel = new BuilderPanel(
  panelRoot,
  catalog,
  {
    selectHull: (hullId) => store.update((state) => withHull(state, catalog.getHull(hullId))),
    setColours: (colours) => store.update((state) => withColours(state, colours)),
    applyPreset: (preset) => store.update((state) => withColours(state, preset.colours)),
    fitAttachment: (slotId, attachmentId) =>
      store.update((state) => withAttachment(state, catalog, slotId, attachmentId)),
    randomiseLoadout: () => store.update((state) => withRandomLoadout(state, catalog)),
    randomiseColours: () => {
      const preset = COLOUR_PRESETS[Math.floor(Math.random() * COLOUR_PRESETS.length)];
      if (preset) store.update((state) => withColours(state, preset.colours));
    },
    reset: () => store.update((state) => createShipState(catalog.getHull(state.hullId), state.colours)),
    copyShareLink: async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        return true;
      } catch {
        return false;
      }
    },
    toggleSlotMarkers: (visible) => scene.setSlotMarkersVisible(visible),
    toggleOutline: (visible) => scene.setOutlineVisible(visible),
    flyShip: () => enterFlight(),
    loadMapFile: async (file) => tryLoadMap(await file.text()),
    resetMap: () => setMap(provingGroundMapDefinition()),
    // Saves the map that will fly next. A parsed map always holds every rock
    // explicitly (any "generate" recipe was expanded on load), so this is also
    // how an authored recipe gets baked into a server-ready file.
    downloadMap: () => {
      const blob = new Blob([JSON.stringify(currentMap, null, 2), '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${currentMap.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
  },
  { onSlotHover: (slotId) => scene.highlightSlot(slotId) },
);

let flight: FlightSession | null = null;
let currentMap: MapDefinition = provingGroundMapDefinition();

function setMap(map: MapDefinition): void {
  currentMap = map;
  panel.setMapName(map.name);
}

/** Parse untrusted JSON text into a map, returning an error message instead of throwing. */
function tryLoadMap(text: string): string | null {
  try {
    setMap(parseMapDefinition(JSON.parse(text) as unknown));
    return null;
  } catch (error) {
    return error instanceof MapParseError || error instanceof SyntaxError ? error.message : String(error);
  }
}

/** `?map=name` loads public/maps/name.json; `?map=https://...` loads a full URL. */
async function loadMapFromQuery(): Promise<void> {
  const name = new URLSearchParams(window.location.search).get('map');
  if (!name) return;
  const url = /^https?:\/\//.test(name) ? name : `${import.meta.env.BASE_URL}maps/${name}.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const error = tryLoadMap(await response.text());
    if (error) console.warn(`Map "${name}" rejected: ${error}`);
  } catch (error) {
    console.warn(`Map "${name}" could not be fetched:`, error);
  }
}

/** Turn a hangar build into the looks-plus-loadout bundle the flight session wants. */
function sessionShip(state: ShipState, name: string): SessionShip {
  const hull = catalog.getHull(state.hullId);
  const weaponMounts = resolveParts(state, catalog)
    .filter((part) => part.attachment.category === 'weapon' || part.attachment.id in WEAPON_PROFILES)
    .map((part) => ({ position: part.slot.position, weapon: weaponProfileFor(part.attachment.id) }));
  return { name, hullName: `${hull.name} ${hull.role.toLowerCase()}`, surface: assembleFromState(state, catalog).mesh, colours: state.colours, weaponMounts };
}

/** Hand the screen to the flight session with the current build and a raider to fight. */
function enterFlight(): void {
  if (flight) return;
  const state = store.get();
  const raider = createShipState(catalog.getHull('hull-gunship'), { main: '#5a2d2d', trim: '#e8e0c9' });
  const navigatorShip = createShipState(catalog.getHull('hull-hauler'), { main: '#2f6f4f', trim: '#e8e0c9' });
  scene.setActive(false);
  document.body.dataset['mode'] = 'flight';
  const map = resolveMap(currentMap);
  flight = new FlightSession(flightRoot!, {
    player: sessionShip(state, `${catalog.getHull(state.hullId).name} (you)`),
    // The raider starts friendly: it holds fire until you shoot it, or until
    // you hang around within 70 units for a couple of seconds and it jumps you.
    npcs: [
      { ...sessionShip(raider, 'Raider'), ...raiderPosition(map), stance: 'friendly', controller: new TurretAi({ ...TURRET_AI, ambushRange: 70, ambushDelay: 2 }) },
      // The Navigator: a guild ship parked in the top-right corner that you can talk to with Space.
      {
        ...sessionShip(navigatorShip, 'Navigator'),
        ...navigatorPosition(map),
        heading: Math.PI * 1.25,
        team: 'guild',
        stance: 'friendly',
        provokable: false,
        invulnerable: true,
        controller: new IdleController(),
        respawnDelay: null,
        accent: '#7fe3a0',
        dialogue: { range: NAVIGATOR_TALK_RANGE, lines: NAVIGATOR_LINES },
      },
    ],
    map,
    onExit: exitFlight,
  });
}

/**
 * Where the raider waits: the bottom-left corner of the map when that is
 * close enough to the spawn to matter (small maps like the Proving Ground),
 * otherwise a little ahead and to the side of the player.
 */
function raiderPosition(map: ResolvedMap): { x: number; z: number } {
  const size = map.halfExtent * 2;
  const corner = fromMapCoords(size * 0.12, size * 0.12, map.halfExtent);
  const far = Math.hypot(corner.x - map.spawn.x, corner.z - map.spawn.z) > 400;
  return far ? { x: map.spawn.x + 70, z: map.spawn.z + 95 } : corner;
}

/** The Navigator parks in the top-right corner of small maps, otherwise just off the spawn. */
function navigatorPosition(map: ResolvedMap): { x: number; z: number } {
  const size = map.halfExtent * 2;
  const corner = fromMapCoords(size * 0.89, size * 0.91, map.halfExtent);
  const far = Math.hypot(corner.x - map.spawn.x, corner.z - map.spawn.z) > 400;
  return far ? { x: map.spawn.x - 45, z: map.spawn.z + 30 } : corner;
}

/** How close (centre to centre) you must be to talk to the Navigator. */
const NAVIGATOR_TALK_RANGE = 30;
const NAVIGATOR_PORTRAIT = `${import.meta.env.BASE_URL}assets/portraits/navigator.png`;
const NAVIGATOR_LINES: readonly DialogueLine[] = [
  { speaker: 'Navigator', portrait: NAVIGATOR_PORTRAIT, text: 'Welcome to the Proving Ground, pilot. I chart these lanes for the Guild.' },
  { speaker: 'Navigator', portrait: NAVIGATOR_PORTRAIT, text: 'That green drift to the north-west is toxic gas. Your shields will soak it for a while. Your hull will not.' },
  { speaker: 'Navigator', portrait: NAVIGATOR_PORTRAIT, text: 'The raider in the south-west corner looks friendly enough. Do not trust him inside seventy units.' },
  { speaker: 'Navigator', portrait: NAVIGATOR_PORTRAIT, text: 'There is iron to the east and crystal to the south. Press M for the map, and bring crystal back when you can.' },
  { speaker: 'Navigator', portrait: NAVIGATOR_PORTRAIT, text: 'Safe flying.' },
];

function exitFlight(): void {
  if (!flight) return;
  flight.dispose();
  flight = null;
  delete document.body.dataset['mode'];
  scene.setActive(true);
}

/** Advance a slot to the next compatible attachment, wrapping through "empty". */
function cycleSlot(slotId: SlotId): void {
  store.update((state) => {
    const hull = catalog.getHull(state.hullId);
    const slot = hull.slots.find((candidate) => candidate.id === slotId);
    if (!slot) return state;
    const options: (string | null)[] = [null, ...catalog.compatibleAttachments(slot).map((a) => a.id)];
    const current = state.fitted[slotId] ?? null;
    const next = options[(options.indexOf(current) + 1) % options.length] ?? null;
    return withAttachment(state, catalog, slotId, next);
  });
}

function sync(state: ShipState, previous: ShipState | null): void {
  const hull = catalog.getHull(state.hullId);
  const ship = assembleFromState(state, catalog);
  const shapeChanged = previous === null || previous.hullId !== state.hullId || previous.fitted !== state.fitted;

  if (shapeChanged) {
    scene.setShip(ship.mesh, state.colours);
    const emptySlots = new Set(hull.slots.filter((slot) => !state.fitted[slot.id]).map((slot) => slot.id));
    scene.setSlots(hull.slots, emptySlots);
    if (previous === null || previous.hullId !== state.hullId) scene.frameShip(ship.bounds);
  } else {
    scene.setColours(state.colours);
  }

  panel.render(state, ship, scene.shipTriangleCount);
  window.history.replaceState(null, '', `#${encodeShipState(state)}`);
}

store.subscribe((state, previous) => sync(state, previous));
sync(store.get(), null);
panel.setMapName(currentMap.name);
void loadMapFromQuery();
