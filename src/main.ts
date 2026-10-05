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
import { FlightView } from './flight/flightView';
import { WEAPON_PROFILES, weaponProfileFor } from './flight/weapons';
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
  },
  { onSlotHover: (slotId) => scene.highlightSlot(slotId) },
);

let flight: FlightView | null = null;

/** Hand the screen to the flight view with the current build. */
function enterFlight(): void {
  if (flight) return;
  const state = store.get();
  const ship = assembleFromState(state, catalog);
  const weaponMounts = resolveParts(state, catalog)
    .filter((part) => part.attachment.category === 'weapon' || part.attachment.id in WEAPON_PROFILES)
    .map((part) => ({ position: part.slot.position, weapon: weaponProfileFor(part.attachment.id) }));
  const enemyHull = catalog.getHull('hull-gunship');
  const enemyState = createShipState(enemyHull, { main: '#5a2d2d', trim: '#e8e0c9' });
  const enemyShip = assembleFromState(enemyState, catalog);
  const enemyMounts = resolveParts(enemyState, catalog)
    .filter((part) => part.attachment.category === 'weapon')
    .map((part) => ({ position: part.slot.position, weapon: weaponProfileFor(part.attachment.id) }));
  scene.setActive(false);
  document.body.dataset['mode'] = 'flight';
  flight = new FlightView(
    flightRoot!,
    {
      player: {
        name: `${catalog.getHull(state.hullId).name} (you)`,
        hullName: `${catalog.getHull(state.hullId).name} ${catalog.getHull(state.hullId).role.toLowerCase()}`,
        surface: ship.mesh,
        colours: state.colours,
        weaponMounts,
      },
      enemy: {
        name: 'Raider',
        hullName: `${enemyHull.name} ${enemyHull.role.toLowerCase()}`,
        surface: enemyShip.mesh,
        colours: enemyState.colours,
        weaponMounts: enemyMounts,
      },
    },
    { onExit: exitFlight },
  );
}

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
