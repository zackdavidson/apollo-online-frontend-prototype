import type { Catalog } from '../catalog/catalog';
import { HULL_MATERIALS, materialAssetPath, type MaterialId } from '../core/materials';
import { COLOUR_PRESETS, type ColourPreset, type ShipColours } from '../core/palette';
import type { AssembledShip } from '../core/ship';
import { STAT_KEYS, type AttachmentId, type HullId, type ShipStats, type SlotDefinition, type SlotId } from '../core/types';
import type { ShipState } from '../state/shipState';
import { clear, el } from './dom';

export interface PanelActions {
  selectHull(hullId: HullId): void;
  setColours(colours: Partial<ShipColours>): void;
  applyPreset(preset: ColourPreset): void;
  setMaterial(materialId: MaterialId): void;
  fitAttachment(slotId: SlotId, attachmentId: AttachmentId | null): void;
  randomiseLoadout(): void;
  randomiseColours(): void;
  reset(): void;
  copyShareLink(): Promise<boolean>;
  toggleSlotMarkers(visible: boolean): void;
  toggleOutline(visible: boolean): void;
  flyShip(): void;
  /** Log in through the gateway and fly on a game server. */
  playOnline(): void;
  /** Load a map definition from a JSON file; resolves to an error message or null. */
  loadMapFile(file: File): Promise<string | null>;
  resetMap(): void;
  downloadMap(): void;
  /** Open the map editor on the map that will fly next. */
  openMapEditor(): void;
}

export interface PanelEvents {
  onSlotHover?: (slotId: SlotId | null) => void;
}

const EMPTY_OPTION = '';

const STAT_LABELS: Readonly<Record<keyof ShipStats, string>> = {
  mass: 'Mass',
  thrust: 'Thrust',
  firepower: 'Firepower',
  cargo: 'Cargo',
  mining: 'Mining',
};

/**
 * Side panel for the builder. The static sections are built once; the slot
 * list is rebuilt only when the hull changes so colour pickers and dropdowns
 * keep focus while the player is interacting with them.
 */
export class BuilderPanel {
  private readonly hullButtons = new Map<HullId, HTMLButtonElement>();
  private readonly mainInput: HTMLInputElement;
  private readonly trimInput: HTMLInputElement;
  private readonly mainHex: HTMLElement;
  private readonly trimHex: HTMLElement;
  private readonly materialButtons = new Map<MaterialId, HTMLButtonElement>();
  private readonly slotList: HTMLElement;
  private readonly slotSelects = new Map<SlotId, HTMLSelectElement>();
  private readonly slotRows = new Map<SlotId, HTMLElement>();
  private readonly hullSummary: HTMLElement;
  private readonly statValues = new Map<keyof ShipStats | 'triangles', HTMLElement>();
  private readonly shareStatus: HTMLElement;
  private readonly mapName: HTMLElement;
  private readonly mapStatus: HTMLElement;
  private renderedHullId: HullId | null = null;

  constructor(
    root: HTMLElement,
    private readonly catalog: Catalog,
    private readonly actions: PanelActions,
    private readonly events: PanelEvents = {},
  ) {
    this.mainInput = el('input', { type: 'color', id: 'colour-main' });
    this.trimInput = el('input', { type: 'color', id: 'colour-trim' });
    this.mainHex = el('code', { className: 'hex' });
    this.trimHex = el('code', { className: 'hex' });
    this.slotList = el('div', { className: 'slot-list' });
    this.hullSummary = el('p', { className: 'muted hull-summary' });
    this.shareStatus = el('span', { className: 'share-status muted' });
    this.mapName = el('span', { className: 'map-name' });
    this.mapStatus = el('span', { className: 'muted map-status' });

    this.mainInput.addEventListener('input', () => this.actions.setColours({ main: this.mainInput.value }));
    this.trimInput.addEventListener('input', () => this.actions.setColours({ trim: this.trimInput.value }));

    clear(root);
    root.append(
      this.buildHeader(),
      this.buildHullSection(),
      this.buildColourSection(),
      this.buildLoadoutSection(),
      this.buildStatsSection(),
      this.buildActionsSection(),
      this.buildMapSection(),
    );
  }

  /** Show which map the next flight will use. */
  setMapName(name: string): void {
    this.mapName.textContent = name;
  }

  render(state: ShipState, ship: AssembledShip, triangleCount: number): void {
    const hull = this.catalog.getHull(state.hullId);

    for (const [hullId, button] of this.hullButtons) {
      button.classList.toggle('active', hullId === state.hullId);
    }
    this.hullSummary.textContent = hull.description;

    if (this.mainInput.value !== state.colours.main) this.mainInput.value = state.colours.main;
    if (this.trimInput.value !== state.colours.trim) this.trimInput.value = state.colours.trim;
    this.mainHex.textContent = state.colours.main;
    this.trimHex.textContent = state.colours.trim;
    for (const [materialId, button] of this.materialButtons) button.classList.toggle('active', materialId === state.material);

    if (this.renderedHullId !== hull.id) {
      this.rebuildSlotList(hull.slots);
      this.renderedHullId = hull.id;
    }
    for (const slot of hull.slots) {
      const select = this.slotSelects.get(slot.id);
      const value = state.fitted[slot.id] ?? EMPTY_OPTION;
      if (select && select.value !== value) select.value = value;
      this.slotRows.get(slot.id)?.classList.toggle('empty', value === EMPTY_OPTION);
    }

    this.statValues.get('triangles')?.replaceChildren(triangleCount.toLocaleString());
    for (const key of STAT_KEYS) {
      this.statValues.get(key)?.replaceChildren(String(ship.stats[key]));
    }
  }

  /** Scroll a slot row into view and flash it, e.g. after it was clicked in 3D. */
  focusSlot(slotId: SlotId): void {
    const row = this.slotRows.get(slotId);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.remove('flash');
    void row.offsetWidth; // restart the CSS animation
    row.classList.add('flash');
  }

  setHoveredSlot(slotId: SlotId | null): void {
    for (const [id, row] of this.slotRows) row.classList.toggle('hovered', id === slotId);
  }

  private buildHeader(): HTMLElement {
    const fly = button('Fly this ship', () => this.actions.flyShip());
    fly.classList.add('primary', 'fly-button');
    const online = button('Play online', () => this.actions.playOnline());
    online.classList.add('fly-button');
    return el('header', { className: 'panel-header' }, [
      el('h1', { text: 'Voxel Shipyard' }),
      el('p', { className: 'muted', text: 'Drag to orbit, scroll to zoom. Click a slot marker in the viewport to cycle parts.' }),
      fly,
      online,
    ]);
  }

  private buildHullSection(): HTMLElement {
    const buttons = this.catalog.hulls.map((hull) => {
      const button = el('button', { className: 'hull-button', type: 'button' }, [
        el('span', { className: 'hull-name', text: hull.name }),
        el('span', { className: 'hull-role muted', text: hull.role }),
      ]);
      button.addEventListener('click', () => this.actions.selectHull(hull.id));
      this.hullButtons.set(hull.id, button);
      return button;
    });
    return section('Hull', [el('div', { className: 'hull-grid' }, buttons), this.hullSummary]);
  }

  private buildColourSection(): HTMLElement {
    const presetButtons = COLOUR_PRESETS.map((preset) => {
      const swatch = el('button', { className: 'swatch', type: 'button', title: preset.name }, [
        el('span', { className: 'swatch-main', style: { background: preset.colours.main } }),
        el('span', { className: 'swatch-trim', style: { background: preset.colours.trim } }),
      ]);
      swatch.addEventListener('click', () => this.actions.applyPreset(preset));
      return swatch;
    });
    const materialButtons = HULL_MATERIALS.map((material) => {
      const thumb = el('span', { className: 'material-thumb' });
      if (material.texture) thumb.style.backgroundImage = `url(${import.meta.env.BASE_URL}${materialAssetPath(material.texture)})`;
      const button = el('button', { className: 'material-button', type: 'button', title: material.description }, [
        thumb,
        el('span', { className: 'material-name', text: material.name }),
      ]);
      button.addEventListener('click', () => this.actions.setMaterial(material.id));
      this.materialButtons.set(material.id, button);
      return button;
    });
    return section('Colours', [
      colourRow('Main', this.mainInput, this.mainHex),
      colourRow('Trim', this.trimInput, this.trimHex),
      el('div', { className: 'swatch-row' }, presetButtons),
      el('div', { className: 'material-label muted', text: 'Material (over the main colour)' }),
      el('div', { className: 'material-row' }, materialButtons),
    ]);
  }

  private buildLoadoutSection(): HTMLElement {
    return section('Loadout', [this.slotList]);
  }

  private buildStatsSection(): HTMLElement {
    const rows: HTMLElement[] = [];
    const addRow = (key: keyof ShipStats | 'triangles', label: string): void => {
      const value = el('dd', { text: '0' });
      this.statValues.set(key, value);
      rows.push(el('div', { className: 'stat' }, [el('dt', { text: label }), value]));
    };
    for (const key of STAT_KEYS) addRow(key, STAT_LABELS[key]);
    addRow('triangles', 'Triangles drawn');
    return section('Stats', [el('dl', { className: 'stats' }, rows)]);
  }

  private buildActionsSection(): HTMLElement {
    const randomParts = button('Random parts', () => this.actions.randomiseLoadout());
    const randomColours = button('Random colours', () => this.actions.randomiseColours());
    const reset = button('Reset', () => this.actions.reset());
    const share = button('Copy share link', async () => {
      const ok = await this.actions.copyShareLink();
      this.shareStatus.textContent = ok ? 'Link copied to clipboard.' : 'Could not copy; the URL in the address bar is the share link.';
      window.setTimeout(() => (this.shareStatus.textContent = ''), 3500);
    });
    share.classList.add('primary');

    const markersToggle = checkbox('Slot markers', true, (checked) => this.actions.toggleSlotMarkers(checked));
    const outlineToggle = checkbox('Crease outlines', false, (checked) => this.actions.toggleOutline(checked));

    return section('Actions', [
      el('div', { className: 'button-row' }, [randomParts, randomColours, reset]),
      el('div', { className: 'button-row' }, [share, this.shareStatus]),
      el('div', { className: 'toggle-row' }, [markersToggle, outlineToggle]),
    ]);
  }

  private buildMapSection(): HTMLElement {
    const fileInput = el('input', { type: 'file' });
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const error = await this.actions.loadMapFile(file);
      this.mapStatus.textContent = error ? `Could not load: ${error}` : `Loaded ${file.name}`;
      fileInput.value = '';
    });
    const load = button('Load map JSON…', () => fileInput.click());
    const reset = button('Start map', () => {
      this.actions.resetMap();
      this.mapStatus.textContent = '';
    });
    const download = button('Save map as JSON', () => this.actions.downloadMap());
    const edit = button('Map editor', () => this.actions.openMapEditor());
    edit.classList.add('primary');
    return section('Map', [
      el('p', { className: 'muted' }, ['Next flight: ', this.mapName]),
      el('div', { className: 'button-row' }, [edit, load, reset, download, fileInput]),
      el('div', { className: 'button-row' }, [this.mapStatus]),
      el('p', { className: 'muted', text: 'Maps are JSON: scenery, every rock by id, comet and objects (caches, beacons, gas clouds) and minimap markers. The editor places them on a canvas and reads or writes the same JSON. See README, or ?map=name for public/maps/name.json.' }),
    ]);
  }

  private rebuildSlotList(slots: readonly SlotDefinition[]): void {
    clear(this.slotList);
    this.slotSelects.clear();
    this.slotRows.clear();

    for (const slot of slots) {
      const select = el('select', { id: `slot-${slot.id}` });
      select.append(el('option', { value: EMPTY_OPTION, text: '— empty —' }));
      for (const attachment of this.catalog.compatibleAttachments(slot)) {
        select.append(el('option', { value: attachment.id, text: attachment.name, title: attachment.description }));
      }
      select.addEventListener('change', () => {
        this.actions.fitAttachment(slot.id, select.value === EMPTY_OPTION ? null : select.value);
      });

      const meta = `${slot.size} · ${slot.accepts.join(' / ')} · faces ${slot.facing}`;
      const row = el('div', { className: 'slot-row', dataset: { slotId: slot.id } }, [
        el('div', { className: 'slot-text' }, [
          el('label', { className: 'slot-label', text: slot.label, htmlFor: select.id }),
          el('span', { className: 'slot-meta muted', text: meta }),
        ]),
        select,
      ]);
      row.addEventListener('pointerenter', () => this.events.onSlotHover?.(slot.id));
      row.addEventListener('pointerleave', () => this.events.onSlotHover?.(null));

      this.slotSelects.set(slot.id, select);
      this.slotRows.set(slot.id, row);
      this.slotList.append(row);
    }
  }
}

function section(title: string, children: readonly HTMLElement[]): HTMLElement {
  return el('section', { className: 'panel-section' }, [el('h2', { text: title }), ...children]);
}

function colourRow(label: string, input: HTMLInputElement, hex: HTMLElement): HTMLElement {
  return el('div', { className: 'colour-row' }, [el('label', { text: label, htmlFor: input.id }), input, hex]);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = el('button', { type: 'button', text: label });
  element.addEventListener('click', onClick);
  return element;
}

function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { className: 'toggle' }, [input, label]);
}
