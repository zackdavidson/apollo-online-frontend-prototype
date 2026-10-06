import { clear, el } from '../ui/dom';
import type { CameraMode } from '../scene/cameraRig';
import type { Inventory, ResourceKind } from '../game/loot';
import { fromMapCoords, headingBearing, toMapCoords, worldVectorToMap } from '../game/mapCoords';
import type { ResolvedMarker } from '../game/map';
import { drawMapIcon } from './mapIcons';
import {
  ChatController,
  ChatInterface,
  HelpInterface,
  INTERFACE_IDS,
  InterfaceManager,
  InterfaceStore,
  InventoryInterface,
  MapInterface,
  NoticeInterface,
  PanelInterface,
  ValueStore,
  type HudServices,
  type InterfaceView,
  type InventoryTab,
  type MapWaypointMarker,
  type MapWindowBridge,
  type MenuState,
} from './interfaces';
import { defaultTabs } from './interfaces/tabs';
import type { PixelScope } from '../scene/pixelate';
import type { WeaponGroup } from '../game/weapons';

export interface WeaponGroupReadout {
  readonly id: WeaponGroup;
  readonly key: string;
  readonly label: string;
  /** Number of mounts feeding this group; 0 means the ship has none. */
  readonly mounts: number;
  readonly active: boolean;
  /** 0..1 fill for the bar: cooldown progress or charge level. */
  readonly fill: number;
  readonly phase: 'ready' | 'charging' | 'cooldown';
}

export interface HudInfo {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly mode: CameraMode;
  readonly tiltDegrees: number;
  readonly zoomDistance: number;
  readonly halfExtent: number;
  readonly planets: ReadonlyArray<readonly [number, number]>;
  readonly rocks: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly rocksBroken: number;
  readonly kills: number;
  readonly deaths: number;
  /** Living hostile ships, nearest first. */
  readonly enemies: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  /** Living other-team ships that are friendly right now, nearest first. */
  readonly neutrals: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly message: string | null;
  readonly weapons: readonly WeaponGroupReadout[];
  readonly cargo: Inventory;
  readonly pixelLevel: number;
  readonly pixelScope: PixelScope;
  readonly beacons: ReadonlyArray<{ readonly x: number; readonly z: number; readonly colour: string }>;
  readonly hazards: ReadonlyArray<{ readonly x: number; readonly z: number; readonly radius: number; readonly colour: string }>;
  /** Items lying on the ground, for the maps' red dots. */
  readonly drops: ReadonlyArray<{ readonly x: number; readonly z: number; readonly kind: string; readonly label: string }>;
  /** Map-authored labels and icons. */
  readonly markers: readonly ResolvedMarker[];
  readonly mapName: string;
  /** Weapon items fitted to the player's ship, for the side panel. */
  readonly fitted: ReadonlyArray<{ readonly itemId: string; readonly name: string; readonly group: WeaponGroup; readonly mounts: number }>;
  /** The player's ship, for the side panel. */
  readonly ship: { readonly name: string; readonly hullName: string; readonly shield: number; readonly maxShield: number; readonly hull: number; readonly maxHull: number };
  /** Where the player wants to go, in world coordinates, if set. */
  readonly waypoint: { readonly x: number; readonly z: number } | null;
  /** How far the warp drive reaches from the ship, in world units. */
  readonly warpRange: number;
  /** The shooting star while it is in the sector. */
  readonly comet: { readonly x: number; readonly z: number; readonly vx: number; readonly vz: number; readonly hp: number; readonly maxHp: number } | null;
}

export interface HudActions {
  onExit(): void;
  onToggleCamera(): void;
  onPixelLevel(index: number): void;
  onPixelScope(scope: PixelScope): void;
  /** Clicking the expanded map sets (or clears) the waypoint at that world position. */
  onMapClick(x: number, z: number): void;
  /** The warp drive button: jump to the waypoint if it is within range. */
  onWarp(): void;
  /** A line typed into the chat box. */
  onChatSend(text: string): void;
  /** Right-click (or default-click) on an item in the hold or fitted to the ship; `x`/`y` are client pixels. */
  onItemMenu(target: ItemMenuTarget, x: number, y: number, defaultOnly: boolean): void;
}

export type ItemMenuTarget = { readonly kind: 'inventory'; readonly item: ResourceKind; readonly count: number } | { readonly kind: 'equipped'; readonly itemId: string; readonly group: WeaponGroup };

const CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['W A S D', 'thrust and strafe · Shift boosts'],
  ['Mouse', 'aims · left button fires the selected weapon group'],
  ['1 / 2 / 3', 'switch weapon group'],
  ['Space', 'talk to a nearby ship · continue dialogue · hold to skip'],
  ['Enter', 'chat · /help for this list'],
  ['M', 'expand the map · click it to set or clear a waypoint'],
  ['J', 'engage the warp drive towards the waypoint (or use the button on the map)'],
  ['Wheel', 'zoom · Q / E tilt camera · C camera mode'],
  ['P / O', 'pixelation level · pixelation scope'],
  ['Esc', 'close dialogue, help or map · then back to the hangar'],
];

const MINIMAP_SIZE = 220;
/** World units across the small minimap: a local view centred on the ship. The expanded map shows the whole sector. */
const MINIMAP_SPAN = 260;
/** World-aligned grid spacing on the local view. */
const MINIMAP_GRID_STEP = 50;
/** Inset of the map square from the canvas edge; the compass letters sit on the frame line itself. */
const MINIMAP_INSET = 7;

/** DOM overlay for flight: readouts, camera toggle, controls hint and a minimap. */
export class FlightHud {
  private readonly status: HTMLElement;
  private readonly frame: {
    portrait: HTMLImageElement;
    name: HTMLElement;
    hull: HTMLElement;
    shieldFill: HTMLElement;
    shieldText: HTMLElement;
    hullFill: HTMLElement;
    hullText: HTMLElement;
    pos: HTMLElement;
    hdg: HTMLElement;
    hdgArrow: HTMLElement;
    spd: HTMLElement;
  };
  private readonly prompt: HTMLElement;
  /** Every interface by id; open and close them here or through server commands. */
  readonly interfaces: InterfaceManager;
  readonly chat: ChatController;
  /** The side panel's tabs; add, replace or select to shape it at runtime. */
  readonly inventory: { addTab(tab: InventoryTab): void; removeTab(id: number): void; setTabs(tabs: readonly InventoryTab[]): void; selectTab(id: number): void };
  private readonly store = new InterfaceStore<InterfaceView>();
  private readonly tabs: ValueStore<readonly InventoryTab[]>;
  private readonly info = new ValueStore<HudInfo | null>(null);
  private readonly itemIcons = new ValueStore<Readonly<Record<string, string>>>({});
  private readonly menu = new ValueStore<MenuState | null>(null);
  private lastInfoPush = -Infinity;
  private readonly mapBridge: MapWindowBridge;
  private mapCanvas: HTMLCanvasElement | null = null;
  private mapSize = 0;
  private readonly minimap: HTMLCanvasElement;
  private lastInfo: HudInfo | null = null;
  private readonly message: HTMLElement;
  private readonly hazardVignette: HTMLElement;
  private readonly hazardWarning: HTMLElement;
  private hazardWarningText = '';
  private readonly tooltip: HTMLElement;
  private readonly cometIndicator = new ScreenIndicator('comet-arrow', false);
  private readonly waypointIndicator = new ScreenIndicator('comet-arrow waypoint-arrow', true);

  private readonly weaponBar: HTMLElement;
  private readonly weaponSlots = new Map<WeaponGroup, { root: HTMLElement; fill: HTMLElement; label: HTMLElement; state: HTMLElement; shade: HTMLElement; icon: HTMLImageElement }>();
  private halfExtent = 0;

  constructor(root: HTMLElement, actions: HudActions) {
    // Ship frame: portrait, name, shield and hull, then a navigation strip. No debug readouts.
    const portrait = el('img', { className: 'frame-portrait' });
    portrait.alt = '';
    portrait.draggable = false;
    const name = el('div', { className: 'frame-name' });
    const hull = el('div', { className: 'frame-hull' });
    const shieldFill = el('div', { className: 'frame-fill frame-fill-shield' });
    const shieldText = el('span', { className: 'frame-bar-text' });
    const hullFill = el('div', { className: 'frame-fill frame-fill-hull' });
    const hullText = el('span', { className: 'frame-bar-text' });
    const pos = el('span', { className: 'nav-value' });
    const hdg = el('span', { className: 'nav-value' });
    const hdgArrow = el('span', { className: 'nav-arrow', text: '➤' });
    const spd = el('span', { className: 'nav-value' });
    this.frame = { portrait, name, hull, shieldFill, shieldText, hullFill, hullText, pos, hdg, hdgArrow, spd };
    this.status = el('div', { className: 'hud hud-status ornate' }, [
      el('div', { className: 'ship-frame' }, [
        el('div', { className: 'frame-portrait-wrap' }, [portrait]),
        el('div', { className: 'frame-body' }, [
          name,
          hull,
          el('div', { className: 'frame-bar frame-bar-shield', title: 'Shield' }, [shieldFill, shieldText]),
          el('div', { className: 'frame-bar frame-bar-hull', title: 'Hull' }, [hullFill, hullText]),
        ]),
      ]),
      el('div', { className: 'nav-strip' }, [
        el('div', { className: 'nav-cell' }, [el('span', { className: 'nav-key', text: 'POS' }), pos]),
        el('div', { className: 'nav-cell' }, [el('span', { className: 'nav-key', text: 'HDG' }), hdgArrow, hdg]),
        el('div', { className: 'nav-cell' }, [el('span', { className: 'nav-key', text: 'SPD' }), spd]),
      ]),
    ]);
    this.prompt = el('div', { className: 'hud hud-prompt' });
    this.prompt.style.display = 'none';
    // Interfaces: a React tree fed by small external stores; the session only ever sees the store API.
    this.chat = new ChatController({ onSend: (text) => actions.onChatSend(text) });
    this.tabs = new ValueStore<readonly InventoryTab[]>(defaultTabs());
    this.inventory = {
      addTab: (tab) => this.tabs.update((tabs) => [...tabs.filter((existing) => existing.id !== tab.id), tab]),
      removeTab: (id) => this.tabs.update((tabs) => tabs.filter((tab) => tab.id !== id)),
      setTabs: (tabs) => this.tabs.set([...tabs]),
      selectTab: (id) => this.store.setProps(INTERFACE_IDS.inventory, { tab: id }),
    };
    this.mapBridge = {
      title: new ValueStore(''),
      cursor: new ValueStore(''),
      waypoint: new ValueStore<MapWaypointMarker | null>(null),
      attach: (canvas) => this.attachMapCanvas(canvas),
      onPointerDown: (event) => {
        if (!this.mapCanvas) return;
        mapClick(this.mapCanvas, () => this.mapSize, true)(event);
      },
      onPointerMove: (event) => {
        const point = this.mapCanvas ? this.mapPointAt(this.mapCanvas, this.mapSize, event, true) : null;
        this.mapBridge.cursor.set(point ? `cursor ${point.x.toFixed(0)}, ${point.y.toFixed(0)}` : '');
      },
      onPointerLeave: () => this.mapBridge.cursor.set(''),
    };
    this.store.register({ id: INTERFACE_IDS.chat, slot: 'chat', name: 'Chat', view: ChatInterface });
    this.store.register({ id: INTERFACE_IDS.inventory, slot: 'inventory', name: 'Side panel', view: InventoryInterface });
    this.store.register({ id: INTERFACE_IDS.map, slot: 'main', name: 'Map', view: MapInterface });
    this.store.register({ id: INTERFACE_IDS.help, slot: 'main', name: 'Controls', view: HelpInterface });
    this.store.register({ id: INTERFACE_IDS.panel, slot: 'overlay', name: 'Panel', view: PanelInterface });
    this.store.register({ id: INTERFACE_IDS.notice, slot: 'full_overlay', name: 'Notice', view: NoticeInterface });
    // Only the expanded map takes clicks: they set the waypoint. The small map is read-only.
    const mapClick = (canvas: HTMLCanvasElement, size: () => number, expanded: boolean) => (event: PointerEvent): void => {
      if (event.button !== 0 || this.halfExtent <= 0) return;
      const point = this.mapPointAt(canvas, size(), event, expanded);
      if (!point) return;
      const world = fromMapCoords(point.x, point.y, this.halfExtent);
      actions.onMapClick(world.x, world.z);
    };
    this.minimap = el('canvas', { className: 'hud-minimap', title: 'Local map · M expands it' });
    sizeCanvas(this.minimap, MINIMAP_SIZE);
    const expand = el('button', { type: 'button', className: 'hud-map-expand', text: '⤢', title: 'Expand map (M)' });
    expand.addEventListener('click', () => this.setMapExpanded(!this.mapExpanded));
    this.message = el('div', { className: 'hud hud-message' });
    this.message.style.display = 'none';
    this.hazardVignette = el('div', { className: 'hazard-vignette' });
    this.hazardWarning = el('div', { className: 'hud hud-hazard' });
    this.hazardWarning.style.display = 'none';
    this.tooltip = el('div', { className: 'hud hud-tooltip' });
    this.tooltip.style.display = 'none';
    this.weaponBar = el('div', { className: 'hud hud-weapons' });

    clear(root);
    root.append(
      this.hazardVignette,
      this.message,
      this.hazardWarning,
      this.tooltip,
      this.cometIndicator.root,
      this.waypointIndicator.root,
      this.weaponBar,
      this.prompt,
      el('div', { className: 'hud hud-right-column' }, [el('div', { className: 'minimap-wrap' }, [this.minimap, expand]), this.status]),
    );
    const services: HudServices<HudInfo, HudActions> = { interfaces: this.store, chat: this.chat, tabs: this.tabs, info: this.info, itemIcons: this.itemIcons, actions, controls: CONTROLS, map: this.mapBridge, menu: this.menu };
    this.interfaces = new InterfaceManager(root, this.store, services as HudServices);
    // The chat box and the side panel are open from the start; the rest open on demand.
    this.interfaces.open(INTERFACE_IDS.chat);
    this.interfaces.open(INTERFACE_IDS.inventory);
  }

  get helpVisible(): boolean {
    return this.interfaces.isOpen(INTERFACE_IDS.help);
  }

  setHelpVisible(visible: boolean): void {
    if (visible) this.interfaces.open(INTERFACE_IDS.help);
    else this.interfaces.close(INTERFACE_IDS.help);
  }

  get menuOpen(): boolean {
    return this.menu.get() !== null;
  }

  /** Open the right-click option menu at client pixels; `onPick` gets the chosen index. */
  openMenu(state: MenuState): void {
    this.menu.set(state.options.length ? state : null);
  }

  closeMenu(): void {
    this.menu.set(null);
  }

  /** Item sprites as data URLs, keyed by item id; the inventory draws them. */
  setItemIcons(urls: Readonly<Record<string, string>>): void {
    this.itemIcons.set(urls);
  }

  /** A key hint above the weapon bar, e.g. "Space · Talk to Navigator"; null hides it. */
  setInteractPrompt(prompt: { readonly key: string; readonly text: string } | null): void {
    if (!prompt) {
      this.prompt.style.display = 'none';
      return;
    }
    this.prompt.style.display = '';
    this.prompt.replaceChildren(el('kbd', { text: prompt.key }), el('span', { text: prompt.text }));
  }

  /** The waypoint's position on the expanded map in CSS pixels, for the warp button that floats there. */
  private waypointMarker(info: HudInfo): MapWaypointMarker | null {
    if (!info.waypoint) return null;
    const side = this.mapSize - MINIMAP_INSET * 2;
    const view = this.mapView(true);
    const scale = side / view.span;
    const point = toMapCoords(info.waypoint.x, info.waypoint.z, info.halfExtent);
    const marker = {
      x: Math.round(MINIMAP_INSET + side / 2 + (point.x - view.centreX) * scale),
      y: Math.round(MINIMAP_INSET + side / 2 - (point.y - view.centreY) * scale),
      distance: Math.hypot(info.waypoint.x - info.x, info.waypoint.z - info.z),
      range: info.warpRange,
      inRange: Math.hypot(info.waypoint.x - info.x, info.waypoint.z - info.z) <= info.warpRange,
    };
    const current = this.mapBridge.waypoint.get();
    // Same marker as last frame: keep the old object so React does not re-render.
    if (current && current.x === marker.x && current.y === marker.y && current.inRange === marker.inRange && Math.abs(current.distance - marker.distance) < 0.5) return current;
    return marker;
  }

  /** React hands over the expanded map's canvas when the window mounts; size it and draw straight away. */
  private attachMapCanvas(canvas: HTMLCanvasElement | null): void {
    this.mapCanvas = canvas;
    if (!canvas) return;
    this.mapSize = Math.max(320, Math.floor(Math.min(window.innerWidth - 80, window.innerHeight - 140)));
    sizeCanvas(canvas, this.mapSize);
    if (this.lastInfo) {
      this.mapBridge.title.set(this.lastInfo.mapName);
      this.drawMap(canvas, this.mapSize, this.lastInfo, true);
    }
  }

  get mapExpanded(): boolean {
    return this.interfaces.isOpen(INTERFACE_IDS.map);
  }

  /** Show or hide the large map window (interface 2); it is sized to the viewport when opened. */
  setMapExpanded(expanded: boolean): void {
    if (expanded) this.interfaces.open(INTERFACE_IDS.map);
    else this.interfaces.close(INTERFACE_IDS.map);
  }

  dispose(): void {
    this.interfaces.dispose();
    this.chat.dispose();
  }

  /** The map coordinate under a pointer event on one of the map canvases, or null when on the frame. */
  /** The map window a canvas shows: the whole sector when expanded, otherwise a fixed span around the ship. */
  private mapView(expanded: boolean): { readonly centreX: number; readonly centreY: number; readonly span: number } {
    const size = 2 * this.halfExtent;
    if (expanded || !this.lastInfo) return { centreX: size / 2, centreY: size / 2, span: size };
    const here = toMapCoords(this.lastInfo.x, this.lastInfo.z, this.halfExtent);
    return { centreX: here.x, centreY: here.y, span: MINIMAP_SPAN };
  }

  /** The map coordinate under a pointer event on one of the map canvases, or null when on the frame or off the map. */
  private mapPointAt(canvas: HTMLCanvasElement, size: number, event: PointerEvent, expanded: boolean): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * size;
    const py = ((event.clientY - rect.top) / rect.height) * size;
    const side = size - MINIMAP_INSET * 2;
    if (px < MINIMAP_INSET || px > MINIMAP_INSET + side || py < MINIMAP_INSET || py > MINIMAP_INSET + side) return null;
    const view = this.mapView(expanded);
    const scale = side / view.span;
    const x = view.centreX + (px - MINIMAP_INSET - side / 2) / scale;
    const y = view.centreY - (py - MINIMAP_INSET - side / 2) / scale;
    const limit = 2 * this.halfExtent;
    if (x < 0 || x > limit || y < 0 || y > limit) return null;
    return { x, y };
  }

  update(info: HudInfo): void {
    const here = toMapCoords(info.x, info.z, info.halfExtent);
    const f = this.frame;
    f.name.textContent = info.ship.name;
    f.hull.textContent = info.ship.hullName;
    f.shieldFill.style.width = `${(100 * info.ship.shield) / Math.max(1, info.ship.maxShield)}%`;
    f.shieldText.textContent = `${Math.ceil(info.ship.shield)} / ${info.ship.maxShield}`;
    const hullFraction = info.ship.hull / Math.max(1, info.ship.maxHull);
    f.hullFill.style.width = `${100 * hullFraction}%`;
    f.hullFill.classList.toggle('low', hullFraction < 0.35);
    f.hullText.textContent = `${Math.ceil(info.ship.hull)} / ${info.ship.maxHull}`;
    f.pos.textContent = `${here.x.toFixed(0)} · ${here.y.toFixed(0)}`;
    const bearing = headingBearing(info.heading);
    f.hdg.textContent = `${bearing.toFixed(0).padStart(3, '0')}°`;
    f.hdgArrow.style.transform = `rotate(${(bearing - 90).toFixed(0)}deg)`;
    f.spd.textContent = `${info.speed.toFixed(0)}`;
    this.message.textContent = info.message ?? '';
    this.message.style.display = info.message ? '' : 'none';
    this.updateWeapons(info.weapons, info.fitted);
    this.lastInfo = info;
    this.halfExtent = info.halfExtent;
    this.drawMap(this.minimap, MINIMAP_SIZE, info, false);
    if (this.mapExpanded && this.mapCanvas) {
      this.mapBridge.title.set(info.mapName);
      this.drawMap(this.mapCanvas, this.mapSize, info, true);
      this.mapBridge.waypoint.set(this.waypointMarker(info));
    } else if (this.mapBridge.waypoint.get()) {
      this.mapBridge.waypoint.set(null);
    }
    // React reads the readout a few times a second; the canvases above redraw every frame.
    const now = performance.now();
    if (now - this.lastInfoPush > 120) {
      this.lastInfoPush = now;
      this.info.set(info);
    }
  }

  /**
   * Edge arrow pointing at the comet while it is off screen. `screen` is the
   * comet's projected position in CSS pixels (it may lie outside the view);
   * the element always carries it in data attributes for anything that wants
   * to find the comet on screen.
   */
  setCometIndicator(indicator: ScreenIndicatorInput | null): void {
    this.cometIndicator.update(indicator, indicator ? `comet ${indicator.distance.toFixed(0)}` : '');
  }

  /** The waypoint's arrow when off screen, or its marker when on screen. */
  setWaypointIndicator(indicator: ScreenIndicatorInput | null): void {
    this.waypointIndicator.update(indicator, indicator ? `waypoint ${indicator.distance.toFixed(0)}` : '');
  }

  /** Show a tooltip beside the pointer, or hide it when `tip` is null. */
  /** Pulsing edge glow and a warning line while the player sits inside a hazard. */
  setHazardWarning(warning: { readonly label: string; readonly damagePerSecond: number; readonly colour: string } | null): void {
    if (!warning) {
      if (this.hazardWarningText) {
        this.hazardWarningText = '';
        this.hazardVignette.classList.remove('active');
        this.hazardWarning.style.display = 'none';
      }
      return;
    }
    const text = `⚠ ${warning.label} · ${warning.damagePerSecond} damage/s`;
    if (text === this.hazardWarningText) return;
    this.hazardWarningText = text;
    this.hazardVignette.style.setProperty('--hazard-colour', warning.colour);
    this.hazardVignette.classList.add('active');
    this.hazardWarning.style.display = '';
    this.hazardWarning.style.borderColor = warning.colour;
    this.hazardWarning.style.color = warning.colour;
    this.hazardWarning.textContent = text;
  }

  setTooltip(tip: { readonly title: string; readonly lines: readonly string[]; readonly x: number; readonly y: number; readonly accent: string } | null): void {
    if (!tip) {
      this.tooltip.style.display = 'none';
      return;
    }
    this.tooltip.style.display = '';
    this.tooltip.style.borderColor = tip.accent;
    this.tooltip.style.transform = `translate(${(tip.x + 16).toFixed(0)}px, ${(tip.y + 18).toFixed(0)}px)`;
    this.tooltip.replaceChildren(
      el('div', { className: 'tooltip-title', text: tip.title, style: { color: tip.accent } }),
      ...tip.lines.map((line) => el('div', { className: 'tooltip-line muted', text: line })),
    );
  }

  /** The action bar: one square slot per weapon group with the fitted item's sprite, a key badge and a cooldown shade. */
  private updateWeapons(groups: readonly WeaponGroupReadout[], fitted: HudInfo['fitted']): void {
    const icons = this.itemIcons.get();
    for (const group of groups) {
      let slot = this.weaponSlots.get(group.id);
      if (!slot) {
        const fill = el('div', { className: 'weapon-fill' });
        const shade = el('div', { className: 'weapon-shade' });
        const icon = el('img', { className: 'weapon-icon' });
        icon.alt = '';
        icon.draggable = false;
        const glyph = el('span', { className: 'weapon-glyph', text: group.id === 'guns' ? '✦' : group.id === 'beam' ? '⟋' : '➶' });
        const label = el('span', { className: 'weapon-label' });
        const state = el('span', { className: 'weapon-state muted' });
        const root = el('div', { className: 'weapon-slot', title: `${group.label} · key ${group.key}` }, [
          el('div', { className: 'weapon-square' }, [glyph, icon, shade, el('span', { className: 'weapon-key', text: group.key }), el('span', { className: 'weapon-count' }), el('div', { className: 'weapon-bar' }, [fill])]),
          label,
          state,
        ]);
        this.weaponBar.append(root);
        slot = { root, fill, label, state, shade, icon };
        this.weaponSlots.set(group.id, slot);
      }
      const item = fitted.find((fit) => fit.group === group.id);
      const iconUrl = item ? icons[item.itemId] : undefined;
      if (iconUrl && slot.icon.getAttribute('src') !== iconUrl) slot.icon.src = iconUrl;
      slot.icon.style.display = iconUrl ? '' : 'none';
      slot.root.classList.toggle('has-icon', Boolean(iconUrl));
      slot.root.classList.toggle('active', group.active);
      slot.root.classList.toggle('unavailable', group.mounts === 0);
      slot.root.classList.toggle('charging', group.phase === 'charging');
      slot.root.classList.toggle('ready', group.phase === 'ready' && group.mounts > 0);
      slot.label.textContent = item?.name ?? group.label;
      const count = slot.root.querySelector<HTMLElement>('.weapon-count');
      if (count) count.textContent = group.mounts > 1 ? `×${group.mounts}` : '';
      slot.fill.style.width = `${Math.round(group.fill * 100)}%`;
      slot.shade.style.height = `${Math.round((1 - group.fill) * 100)}%`;
      slot.state.textContent = group.mounts === 0 ? 'empty' : group.phase === 'ready' ? 'ready' : group.phase === 'charging' ? `${Math.round(group.fill * 100)}%` : 'cooling';
    }
  }

  /** The portrait of the player's own ship, rendered once by the scene. */
  setShipPortrait(url: string): void {
    if (url) this.frame.portrait.src = url;
    this.frame.portrait.style.display = url ? '' : 'none';
  }

  /**
   * Draw the map into a square canvas of `size` CSS pixels. The small
   * minimap and the expanded map share this; `expanded` turns on the finer
   * grid, coordinate ticks, label text and icon names.
   */
  private drawMap(canvas: HTMLCanvasElement, size: number, info: HudInfo, expanded: boolean): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = canvas.width / size;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const inset = MINIMAP_INSET;
    const side = size - inset * 2;
    const view = this.mapView(expanded);
    const scale = side / view.span;
    const k = expanded ? Math.max(1.4, size / MINIMAP_SIZE / 1.6) : 1; // glyph scale
    const toMap = (x: number, z: number): [number, number] => {
      const point = toMapCoords(x, z, info.halfExtent);
      return [inset + side / 2 + (point.x - view.centreX) * scale, inset + side / 2 - (point.y - view.centreY) * scale];
    };
    const dir = (worldX: number, worldZ: number): readonly [number, number] => {
      const [mx, my] = worldVectorToMap(worldX, worldZ);
      return [mx, -my];
    };

    context.clearRect(0, 0, size, size);
    context.fillStyle = 'rgba(10, 12, 20, 0.8)';
    roundedRect(context, 0.5, 0.5, size - 1, size - 1, 6);
    context.fill();
    // The square is void; the sector itself is drawn inside it (the whole thing when expanded,
    // whatever part lies around the ship on the small map), with a grid on top.
    context.fillStyle = 'rgba(6, 8, 14, 0.75)';
    context.fillRect(inset, inset, side, side);
    context.save();
    context.beginPath();
    context.rect(inset, inset, side, side);
    context.clip();
    const sectorSize = 2 * info.halfExtent;
    const [sx0, sy1] = toMap(...mapToWorldXZ(0, 0, info.halfExtent));
    const [sx1, sy0] = toMap(...mapToWorldXZ(sectorSize, sectorSize, info.halfExtent));
    context.fillStyle = 'rgba(18, 24, 38, 0.65)';
    context.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    context.strokeStyle = 'rgba(120, 140, 170, 0.14)';
    context.lineWidth = 1;
    const cells = 10;
    if (expanded) {
      for (let i = 1; i < cells; i++) {
        const at = inset + (side * i) / cells + 0.5;
        context.beginPath();
        context.moveTo(at, inset);
        context.lineTo(at, inset + side);
        context.moveTo(inset, at);
        context.lineTo(inset + side, at);
        context.stroke();
      }
    } else {
      // World-aligned grid lines so the ground visibly slides under the ship.
      const left = view.centreX - view.span / 2;
      const bottom = view.centreY - view.span / 2;
      for (let gx = Math.ceil(left / MINIMAP_GRID_STEP) * MINIMAP_GRID_STEP; gx <= left + view.span; gx += MINIMAP_GRID_STEP) {
        const px = Math.round(inset + side / 2 + (gx - view.centreX) * scale) + 0.5;
        context.beginPath();
        context.moveTo(px, inset);
        context.lineTo(px, inset + side);
        context.stroke();
      }
      for (let gy = Math.ceil(bottom / MINIMAP_GRID_STEP) * MINIMAP_GRID_STEP; gy <= bottom + view.span; gy += MINIMAP_GRID_STEP) {
        const py = Math.round(inset + side / 2 - (gy - view.centreY) * scale) + 0.5;
        context.beginPath();
        context.moveTo(inset, py);
        context.lineTo(inset + side, py);
        context.stroke();
      }
      // The sector's edge, where there is one in view.
      context.strokeStyle = 'rgba(150, 160, 180, 0.6)';
      context.strokeRect(sx0 + 0.5, sy0 + 0.5, sx1 - sx0 - 1, sy1 - sy0 - 1);
    }
    context.restore();
    if (expanded) {
      context.fillStyle = 'rgba(160, 175, 200, 0.55)';
      context.font = '10px system-ui, sans-serif';
      context.textBaseline = 'bottom';
      for (let i = 1; i < cells; i++) {
        const value = ((2 * info.halfExtent * i) / cells).toFixed(0);
        const at = inset + (side * i) / cells;
        // Kept clear of the S and W compass tabs on the frame.
        context.textAlign = 'center';
        context.fillText(value, at, inset + side - 9);
        context.textAlign = 'left';
        context.fillText(value, inset + 12, inset + side - (side * i) / cells + 4);
      }
    }
    context.strokeStyle = 'rgba(150, 160, 180, 0.8)';
    context.strokeRect(inset + 0.5, inset + 0.5, side - 1, side - 1);

    // Everything on the map is clipped to the square.
    context.save();
    context.beginPath();
    context.rect(inset, inset, side, side);
    context.clip();

    for (const hazard of info.hazards) {
      const [hx, hz] = toMap(hazard.x, hazard.z);
      const pr = Math.max(3, hazard.radius * scale);
      context.fillStyle = hazard.colour;
      context.globalAlpha = 0.28;
      context.beginPath();
      context.arc(hx, hz, pr, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.7;
      context.lineWidth = 1;
      context.strokeStyle = hazard.colour;
      context.stroke();
      context.globalAlpha = 1;
    }
    context.fillStyle = 'rgba(160, 150, 140, 0.65)';
    const dot = 1.5 * k;
    for (const rock of info.rocks) {
      const [mx, mz] = toMap(rock.x, rock.z);
      context.fillRect(mx - dot / 2, mz - dot / 2, dot, dot);
    }
    // Items on the ground: red dots on the local minimap only, old-school style. The sector map stays clean.
    if (!expanded) {
      for (const drop of info.drops) {
        const [dx, dz] = toMap(drop.x, drop.z);
        context.fillStyle = '#ff3b3b';
        context.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(dx, dz, 3, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      }
    }
    context.fillStyle = 'rgba(200, 180, 140, 0.8)';
    for (const [px, pz] of info.planets) {
      const [mx, mz] = toMap(px, pz);
      context.beginPath();
      context.arc(mx, mz, 2.2 * k, 0, Math.PI * 2);
      context.fill();
    }
    for (const beacon of info.beacons) {
      const [bx, bz] = toMap(beacon.x, beacon.z);
      const d = 3.5 * k;
      context.fillStyle = beacon.colour;
      context.beginPath();
      context.moveTo(bx, bz - d);
      context.lineTo(bx + d, bz);
      context.lineTo(bx, bz + d);
      context.lineTo(bx - d, bz);
      context.closePath();
      context.fill();
    }
    // Map-authored icons, then enemies and the comet on top of them.
    const iconSize = expanded ? 24 : 13;
    for (const marker of info.markers) {
      if (marker.type !== 'icon' || (!expanded && !marker.onMinimap)) continue;
      const [ix, iz] = toMap(marker.x, marker.z);
      drawMapIcon(context, marker.icon, ix, iz, iconSize, marker.colour);
    }
    context.fillStyle = '#7fe3a0';
    for (const neutral of info.neutrals) {
      const [nx, nz] = toMap(neutral.x, neutral.z);
      context.beginPath();
      context.arc(nx, nz, 3 * k, 0, Math.PI * 2);
      context.fill();
    }
    for (const enemy of info.enemies) {
      const [ex, ez] = toMap(enemy.x, enemy.z);
      context.fillStyle = '#ff5c5c';
      context.beginPath();
      context.arc(ex, ez, 3 * k, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(255, 92, 92, 0.45)';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(ex, ez, 5.5 * k, 0, Math.PI * 2);
      context.stroke();
    }
    if (info.comet) {
      const [cx, cz] = toMap(info.comet.x, info.comet.z);
      const speed = Math.hypot(info.comet.vx, info.comet.vz) || 1;
      const pulse = (3 + Math.sin(performance.now() / 180) * 1.2) * k;
      const [tx, tz] = dir(info.comet.vx / speed, info.comet.vz / speed);
      context.strokeStyle = 'rgba(159, 216, 255, 0.8)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(cx, cz);
      context.lineTo(cx - tx * 12 * k, cz - tz * 12 * k);
      context.stroke();
      context.fillStyle = '#dff4ff';
      context.beginPath();
      context.arc(cx, cz, pulse, 0, Math.PI * 2);
      context.fill();
    }
    const [sx, sz] = toMap(info.x, info.z);
    // Warp drive range: a dashed ring around the ship.
    context.save();
    context.setLineDash([4 * k, 4 * k]);
    context.strokeStyle = 'rgba(111, 211, 255, 0.55)';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(sx, sz, info.warpRange * scale, 0, Math.PI * 2);
    context.stroke();
    // The waypoint: a dashed line from the ship and a diamond with a ring.
    if (info.waypoint) {
      const [wx, wz] = toMap(info.waypoint.x, info.waypoint.z);
      context.strokeStyle = 'rgba(111, 211, 255, 0.5)';
      context.setLineDash([3 * k, 3 * k]);
      context.beginPath();
      context.moveTo(sx, sz);
      context.lineTo(wx, wz);
      context.stroke();
      context.setLineDash([]);
      const d = 4.5 * k;
      context.fillStyle = '#6fd3ff';
      context.beginPath();
      context.moveTo(wx, wz - d);
      context.lineTo(wx + d, wz);
      context.lineTo(wx, wz + d);
      context.lineTo(wx - d, wz);
      context.closePath();
      context.fill();
      context.strokeStyle = 'rgba(111, 211, 255, 0.8)';
      context.beginPath();
      context.arc(wx, wz, 7 * k, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    const [hx, hz] = dir(Math.sin(info.heading), Math.cos(info.heading));
    context.strokeStyle = '#6fd3ff';
    context.lineWidth = 1.5 * k;
    context.beginPath();
    context.moveTo(sx, sz);
    context.lineTo(sx + hx * 8 * k, sz + hz * 8 * k);
    context.stroke();
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(sx, sz, 2.5 * k, 0, Math.PI * 2);
    context.fill();

    // Text last: region labels, and icon names on the expanded map.
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    for (const marker of info.markers) {
      if (marker.type === 'label') {
        if (!expanded && !marker.onMinimap) continue;
        const [lx, lz] = toMap(marker.x, marker.z);
        const px = expanded ? marker.size * 1.25 : marker.size;
        context.font = `600 ${px}px system-ui, sans-serif`;
        context.textAlign = 'center';
        outlinedText(context, marker.text, lx, lz, marker.colour);
      } else if (expanded && marker.label) {
        const [ix, iz] = toMap(marker.x, marker.z);
        context.font = '600 12px system-ui, sans-serif';
        context.textAlign = 'left';
        outlinedText(context, marker.label, ix + iconSize * 0.65, iz, '#e6ecf5');
      }
    }
    context.restore();

    // Compass letters on the frame line itself, each on a small dark tab.
    const mid = inset + side / 2;
    const letters: ReadonlyArray<readonly [string, number, number]> = [
      ['N', mid, inset],
      ['S', mid, inset + side],
      ['W', inset, mid],
      ['E', inset + side, mid],
    ];
    context.font = 'bold 10px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const [letter, lx, ly] of letters) {
      context.fillStyle = 'rgba(10, 12, 20, 0.95)';
      roundedRect(context, lx - 7, ly - 6, 14, 12, 3);
      context.fill();
      context.strokeStyle = 'rgba(150, 160, 180, 0.6)';
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = letter === 'N' ? '#6fd3ff' : 'rgba(210, 218, 230, 0.9)';
      context.fillText(letter, lx, ly + 0.5);
    }
  }
}

/** World XZ for a map coordinate, as a tuple for spreading into the canvas mapping. */
function mapToWorldXZ(mapX: number, mapY: number, halfExtent: number): [number, number] {
  const world = fromMapCoords(mapX, mapY, halfExtent);
  return [world.x, world.z];
}

/** Size a canvas for crisp drawing at the device pixel ratio while laying out at `size` CSS pixels. */
function sizeCanvas(canvas: HTMLCanvasElement, size: number): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
}

function outlinedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(6, 8, 14, 0.85)';
  context.strokeText(text, x, y);
  context.fillStyle = colour;
  context.fillText(text, x, y);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}


export interface ScreenIndicatorInput {
  readonly screen: { readonly x: number; readonly y: number };
  readonly onScreen: boolean;
  readonly distance: number;
  readonly width: number;
  readonly height: number;
}

/**
 * An arrow at the screen edge pointing at something off screen, with a
 * distance label. With `markOnScreen` it instead sits on the thing itself
 * while it is in view (the comet draws itself; a waypoint does not).
 */
class ScreenIndicator {
  readonly root: HTMLElement;
  private readonly glyph: HTMLElement;
  private readonly label: HTMLElement;

  constructor(className: string, private readonly markOnScreen: boolean) {
    this.glyph = el('span', { className: 'comet-arrow-glyph', text: '➤' });
    this.label = el('span', { className: 'comet-arrow-label' });
    this.root = el('div', { className }, [this.glyph, this.label]);
    this.root.style.display = 'none';
  }

  update(indicator: ScreenIndicatorInput | null, text: string): void {
    if (!indicator) {
      this.root.style.display = 'none';
      delete this.root.dataset['screenX'];
      delete this.root.dataset['screenY'];
      return;
    }
    this.root.dataset['screenX'] = indicator.screen.x.toFixed(0);
    this.root.dataset['screenY'] = indicator.screen.y.toFixed(0);
    this.root.dataset['onScreen'] = String(indicator.onScreen);
    this.label.textContent = text;
    if (indicator.onScreen) {
      if (!this.markOnScreen) {
        this.root.style.display = 'none';
        return;
      }
      this.root.style.display = '';
      this.root.classList.add('on-screen');
      this.root.style.transform = `translate(-50%, -50%) translate(${indicator.screen.x.toFixed(0)}px, ${indicator.screen.y.toFixed(0)}px)`;
      this.glyph.textContent = '◆';
      this.glyph.style.transform = '';
      return;
    }
    this.root.classList.remove('on-screen');
    const cx = indicator.width / 2;
    const cy = indicator.height / 2;
    const dx = indicator.screen.x - cx;
    const dy = indicator.screen.y - cy;
    const margin = 46;
    const scale = Math.min((cx - margin) / Math.abs(dx || 1e-6), (cy - margin) / Math.abs(dy || 1e-6));
    let x = cx + dx * scale;
    const y = cy + dy * scale;
    // Keep edge arrows out from behind the minimap column in the top-right corner.
    if (x > indicator.width - 260 && y < 520) x = indicator.width - 260;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    this.root.style.display = '';
    this.root.style.transform = `translate(-50%, -50%) translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    this.glyph.textContent = '➤';
    this.glyph.style.transform = `rotate(${angle.toFixed(0)}deg)`;
  }
}
