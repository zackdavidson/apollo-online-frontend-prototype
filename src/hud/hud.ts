import { clear, el } from '../ui/dom';
import type { CameraMode } from '../scene/cameraRig';
import { RESOURCES, RESOURCE_KINDS, inventoryValue, type Inventory } from '../game/loot';
import { fromMapCoords, headingBearing, toMapCoords, worldVectorToMap } from '../game/mapCoords';
import type { ResolvedMarker } from '../game/map';
import { drawMapIcon } from './mapIcons';
import { ChatPanel } from './chat';
import { PIXEL_LEVELS, type PixelScope } from '../scene/pixelate';
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
  /** Map-authored labels and icons. */
  readonly markers: readonly ResolvedMarker[];
  readonly mapName: string;
  /** The shooting star while it is in the sector. */
  readonly comet: { readonly x: number; readonly z: number; readonly vx: number; readonly vz: number; readonly hp: number; readonly maxHp: number } | null;
}

export interface HudActions {
  onExit(): void;
  onToggleCamera(): void;
  onPixelLevel(index: number): void;
  onPixelScope(scope: PixelScope): void;
  /** Clicking the minimap warps the ship to that world position. */
  onTeleport(x: number, z: number): void;
  /** A line typed into the chat box. */
  onChatSend(text: string): void;
}

const CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['W A S D', 'thrust and strafe · Shift boosts'],
  ['Mouse', 'aims · left button fires the selected weapon group'],
  ['1 / 2 / 3', 'switch weapon group'],
  ['Space', 'talk to a nearby ship · continue dialogue · hold to skip'],
  ['Enter', 'chat · /help for this list'],
  ['M', 'expand the map · click a map to warp there'],
  ['Wheel', 'zoom · Q / E tilt camera · C camera mode'],
  ['P / O', 'pixelation level · pixelation scope'],
  ['Esc', 'close dialogue, help or map · then back to the hangar'],
];

const MINIMAP_SIZE = 220;
/** Inset of the map square from the canvas edge; the compass letters sit on the frame line itself. */
const MINIMAP_INSET = 7;

/** DOM overlay for flight: readouts, camera toggle, controls hint and a minimap. */
export class FlightHud {
  private readonly status: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly help: HTMLElement;
  readonly chat: ChatPanel;
  private readonly cameraButton: HTMLButtonElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly bigMap: HTMLElement;
  private readonly bigMapCanvas: HTMLCanvasElement;
  private readonly bigMapTitle: HTMLElement;
  private readonly bigMapCursor: HTMLElement;
  private bigMapSize = 0;
  private bigMapCursorText = '';
  private lastInfo: HudInfo | null = null;
  private readonly message: HTMLElement;
  private readonly hazardVignette: HTMLElement;
  private readonly hazardWarning: HTMLElement;
  private hazardWarningText = '';
  private readonly tooltip: HTMLElement;
  private readonly cometArrow: HTMLElement;
  private readonly cometArrowLabel: HTMLElement;
  private readonly weaponBar: HTMLElement;
  private readonly pixelSelect: HTMLSelectElement;
  private readonly scopeSelect: HTMLSelectElement;
  private readonly weaponSlots = new Map<WeaponGroup, { root: HTMLElement; fill: HTMLElement; label: HTMLElement; state: HTMLElement }>();
  private halfExtent = 0;

  constructor(root: HTMLElement, actions: HudActions) {
    this.status = el('div', { className: 'hud-status' });
    this.prompt = el('div', { className: 'hud hud-prompt' });
    this.prompt.style.display = 'none';
    this.help = el('div', { className: 'hud hud-help' }, [
      el('h3', { text: 'Controls' }),
      el('dl', {}, CONTROLS.flatMap(([key, what]) => [el('dt', { text: key }), el('dd', { text: what })])),
      el('p', { className: 'muted', text: 'Esc or the Controls button closes this.' }),
    ]);
    this.help.style.display = 'none';
    this.chat = new ChatPanel({ onSend: (text) => actions.onChatSend(text) });
    this.cameraButton = el('button', { type: 'button', text: 'Camera: perspective' });
    this.cameraButton.addEventListener('click', actions.onToggleCamera);
    const helpButton = el('button', { type: 'button', text: 'Controls' });
    helpButton.addEventListener('click', () => this.setHelpVisible(!this.helpVisible));
    const exit = el('button', { type: 'button', text: 'Hangar (Esc)', className: 'primary span-2' });
    exit.addEventListener('click', actions.onExit);
    this.pixelSelect = el('select', { title: 'Pixelation level (P)' });
    PIXEL_LEVELS.forEach((level, index) => this.pixelSelect.append(el('option', { value: String(index), text: `Pixels: ${level.label}` })));
    this.pixelSelect.title = 'Pixelation level (P)';
    this.pixelSelect.addEventListener('change', () => actions.onPixelLevel(Number(this.pixelSelect.value)));
    this.scopeSelect = el('select', { title: 'What gets pixelated (O)' });
    this.scopeSelect.append(el('option', { value: '3d', text: '3D only' }), el('option', { value: 'all', text: 'Everything' }));
    this.scopeSelect.addEventListener('change', () => actions.onPixelScope(this.scopeSelect.value as PixelScope));
    this.minimap = el('canvas', { className: 'hud-minimap', title: 'Click to warp there · M expands' });
    sizeCanvas(this.minimap, MINIMAP_SIZE);
    const expand = el('button', { type: 'button', className: 'hud-map-expand', text: '⤢', title: 'Expand map (M)' });
    expand.addEventListener('click', () => this.setMapExpanded(!this.mapExpanded));
    this.bigMapCanvas = el('canvas', { title: 'Click to warp there' });
    this.bigMapTitle = el('span');
    this.bigMapCursor = el('span', { className: 'muted' });
    this.bigMap = el('div', { className: 'hud hud-bigmap' }, [
      el('div', { className: 'bigmap-title' }, [this.bigMapTitle, el('span', { className: 'muted', text: 'click to warp · M or Esc closes' })]),
      this.bigMapCanvas,
      el('div', { className: 'bigmap-caption' }, [el('span', { className: 'muted', text: 'map coordinates, (0, 0) bottom-left' }), this.bigMapCursor]),
    ]);
    this.bigMap.style.display = 'none';
    // Clicking either map warps to that map coordinate; the frame is ignored.
    const warpFromClick = (canvas: HTMLCanvasElement, size: number) => (event: PointerEvent): void => {
      if (event.button !== 0 || this.halfExtent <= 0) return;
      const point = this.mapPointAt(canvas, size, event);
      if (!point) return;
      const world = fromMapCoords(point.x, point.y, this.halfExtent);
      actions.onTeleport(world.x, world.z);
    };
    this.minimap.addEventListener('pointerdown', warpFromClick(this.minimap, MINIMAP_SIZE));
    this.bigMapCanvas.addEventListener('pointerdown', (event) => warpFromClick(this.bigMapCanvas, this.bigMapSize)(event));
    this.bigMapCanvas.addEventListener('pointermove', (event) => {
      const point = this.mapPointAt(this.bigMapCanvas, this.bigMapSize, event);
      this.bigMapCursorText = point ? `cursor ${point.x.toFixed(0)}, ${point.y.toFixed(0)}` : '';
      this.bigMapCursor.textContent = this.bigMapCursorText;
    });
    this.bigMapCanvas.addEventListener('pointerleave', () => {
      this.bigMapCursor.textContent = '';
    });
    this.message = el('div', { className: 'hud hud-message' });
    this.message.style.display = 'none';
    this.hazardVignette = el('div', { className: 'hazard-vignette' });
    this.hazardWarning = el('div', { className: 'hud hud-hazard' });
    this.hazardWarning.style.display = 'none';
    this.tooltip = el('div', { className: 'hud hud-tooltip' });
    this.tooltip.style.display = 'none';
    this.cometArrowLabel = el('span', { className: 'comet-arrow-label' });
    this.cometArrow = el('div', { className: 'comet-arrow' }, [el('span', { className: 'comet-arrow-glyph', text: '➤' }), this.cometArrowLabel]);
    this.cometArrow.style.display = 'none';
    this.weaponBar = el('div', { className: 'hud hud-weapons' });

    clear(root);
    root.append(
      this.hazardVignette,
      this.message,
      this.hazardWarning,
      this.tooltip,
      this.cometArrow,
      this.weaponBar,
      this.prompt,
      el('div', { className: 'hud hud-right-column' }, [
        el('div', { className: 'minimap-wrap' }, [this.minimap, expand]),
        this.status,
        el('div', { className: 'hud-settings' }, [this.cameraButton, helpButton, this.pixelSelect, this.scopeSelect, exit]),
      ]),
      this.chat.root,
      this.help,
      this.bigMap,
    );
  }

  get helpVisible(): boolean {
    return this.help.style.display !== 'none';
  }

  setHelpVisible(visible: boolean): void {
    this.help.style.display = visible ? '' : 'none';
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

  get mapExpanded(): boolean {
    return this.bigMap.style.display !== 'none';
  }

  /** Show or hide the large map overlay; it is sized to the viewport when opened. */
  setMapExpanded(expanded: boolean): void {
    if (expanded === this.mapExpanded) return;
    if (expanded) {
      this.bigMapSize = Math.max(320, Math.floor(Math.min(window.innerWidth - 80, window.innerHeight - 140)));
      sizeCanvas(this.bigMapCanvas, this.bigMapSize);
      this.bigMap.style.display = '';
      if (this.lastInfo) this.drawMap(this.bigMapCanvas, this.bigMapSize, this.lastInfo, true);
    } else {
      this.bigMap.style.display = 'none';
    }
  }

  /** The map coordinate under a pointer event on one of the map canvases, or null when on the frame. */
  private mapPointAt(canvas: HTMLCanvasElement, size: number, event: PointerEvent): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * size;
    const py = ((event.clientY - rect.top) / rect.height) * size;
    const side = size - MINIMAP_INSET * 2;
    const u = (px - MINIMAP_INSET) / side;
    const v = (py - MINIMAP_INSET) / side;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { x: u * 2 * this.halfExtent, y: (1 - v) * 2 * this.halfExtent };
  }

  update(info: HudInfo): void {
    const here = toMapCoords(info.x, info.z, info.halfExtent);
    const nearest = (ships: ReadonlyArray<{ readonly x: number; readonly z: number }>): number | null =>
      ships[0] ? Math.hypot(ships[0].x - info.x, ships[0].z - info.z) : null;
    const enemy = nearest(info.enemies);
    const neutral = nearest(info.neutrals);
    this.status.replaceChildren(
      el('div', { className: 'status-main', text: `x ${here.x.toFixed(0)}  y ${here.y.toFixed(0)}  ·  hdg ${headingBearing(info.heading).toFixed(0).padStart(3, '0')}°  ·  ${info.speed.toFixed(0)} u/s` }),
      el('div', { className: 'muted', text: `${info.mode} · tilt ${info.tiltDegrees.toFixed(0)}° · zoom ${info.zoomDistance.toFixed(0)} · kills ${info.kills} · deaths ${info.deaths} · rocks ${info.rocksBroken}` }),
      el('div', { className: 'hud-cargo' }, [
        ...RESOURCE_KINDS.map((kind) =>
          el('span', { className: 'cargo-item', style: { color: RESOURCES[kind].colour } }, [`${RESOURCES[kind].label.toLowerCase()} ${info.cargo[kind]} `]),
        ),
        el('span', { className: 'muted', text: `· worth ${inventoryValue(info.cargo)}` }),
      ]),
      el('div', {
        className: 'muted',
        text: enemy !== null ? `enemy ${enemy.toFixed(0)} away` : neutral !== null ? `no hostiles · friendly ship ${neutral.toFixed(0)} away` : 'no enemies up',
      }),
      el('div', {
        className: 'hud-comet',
        text: info.comet ? `comet ${Math.hypot(info.comet.x - info.x, info.comet.z - info.z).toFixed(0)} away · ${Math.ceil(info.comet.hp)} / ${info.comet.maxHp} hp` : 'no comet in the sector',
      }),
    );
    this.message.textContent = info.message ?? '';
    this.message.style.display = info.message ? '' : 'none';
    this.updateWeapons(info.weapons);
    this.cameraButton.textContent = `Camera: ${info.mode}`;
    if (this.pixelSelect.value !== String(info.pixelLevel)) this.pixelSelect.value = String(info.pixelLevel);
    if (this.scopeSelect.value !== info.pixelScope) this.scopeSelect.value = info.pixelScope;
    this.lastInfo = info;
    this.halfExtent = info.halfExtent;
    this.drawMap(this.minimap, MINIMAP_SIZE, info, false);
    if (this.mapExpanded) {
      this.bigMapTitle.textContent = info.mapName;
      this.drawMap(this.bigMapCanvas, this.bigMapSize, info, true);
    }
  }

  /**
   * Edge arrow pointing at the comet while it is off screen. `screen` is the
   * comet's projected position in CSS pixels (it may lie outside the view);
   * the element always carries it in data attributes for anything that wants
   * to find the comet on screen.
   */
  setCometIndicator(indicator: { readonly screen: { readonly x: number; readonly y: number }; readonly onScreen: boolean; readonly distance: number; readonly width: number; readonly height: number } | null): void {
    if (!indicator) {
      this.cometArrow.style.display = 'none';
      delete this.cometArrow.dataset['screenX'];
      delete this.cometArrow.dataset['screenY'];
      return;
    }
    this.cometArrow.dataset['screenX'] = indicator.screen.x.toFixed(0);
    this.cometArrow.dataset['screenY'] = indicator.screen.y.toFixed(0);
    this.cometArrow.dataset['onScreen'] = String(indicator.onScreen);
    if (indicator.onScreen) {
      this.cometArrow.style.display = 'none';
      return;
    }
    const cx = indicator.width / 2;
    const cy = indicator.height / 2;
    const dx = indicator.screen.x - cx;
    const dy = indicator.screen.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    const margin = 46;
    const scale = Math.min((cx - margin) / Math.abs(dx || 1e-6), (cy - margin) / Math.abs(dy || 1e-6));
    const x = cx + dx * scale;
    const y = cy + dy * scale;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    this.cometArrow.style.display = '';
    this.cometArrow.style.transform = `translate(-50%, -50%) translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    (this.cometArrow.firstElementChild as HTMLElement).style.transform = `rotate(${angle.toFixed(0)}deg)`;
    this.cometArrowLabel.textContent = `comet ${indicator.distance.toFixed(0)}`;
    void length;
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

  private updateWeapons(groups: readonly WeaponGroupReadout[]): void {
    for (const group of groups) {
      let slot = this.weaponSlots.get(group.id);
      if (!slot) {
        const fill = el('div', { className: 'weapon-fill' });
        const label = el('span', { className: 'weapon-label' });
        const state = el('span', { className: 'weapon-state muted' });
        const root = el('div', { className: 'weapon-slot' }, [
          el('span', { className: 'weapon-key', text: group.key }),
          el('div', { className: 'weapon-body' }, [label, el('div', { className: 'weapon-bar' }, [fill]), state]),
        ]);
        this.weaponBar.append(root);
        slot = { root, fill, label, state };
        this.weaponSlots.set(group.id, slot);
      }
      slot.root.classList.toggle('active', group.active);
      slot.root.classList.toggle('unavailable', group.mounts === 0);
      slot.root.classList.toggle('charging', group.phase === 'charging');
      slot.label.textContent = group.mounts > 0 ? `${group.label} ×${group.mounts}` : `${group.label} (none fitted)`;
      slot.fill.style.width = `${Math.round(group.fill * 100)}%`;
      slot.state.textContent = group.mounts === 0 ? '' : group.phase === 'ready' ? 'ready' : group.phase === 'charging' ? `charging ${Math.round(group.fill * 100)}%` : 'cooling';
    }
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
    const scale = side / (2 * info.halfExtent);
    const k = expanded ? Math.max(1.4, size / MINIMAP_SIZE / 1.6) : 1; // glyph scale
    const toMap = (x: number, z: number): [number, number] => {
      const point = toMapCoords(x, z, info.halfExtent);
      return [inset + point.x * scale, inset + side - point.y * scale];
    };
    const dir = (worldX: number, worldZ: number): readonly [number, number] => {
      const [mx, my] = worldVectorToMap(worldX, worldZ);
      return [mx, -my];
    };

    context.clearRect(0, 0, size, size);
    context.fillStyle = 'rgba(10, 12, 20, 0.8)';
    roundedRect(context, 0.5, 0.5, size - 1, size - 1, 6);
    context.fill();
    // Map square with a grid; the expanded map gets a finer one with coordinate ticks.
    context.fillStyle = 'rgba(18, 24, 38, 0.65)';
    context.fillRect(inset, inset, side, side);
    const cells = expanded ? 10 : 4;
    context.strokeStyle = 'rgba(120, 140, 170, 0.14)';
    context.lineWidth = 1;
    for (let i = 1; i < cells; i++) {
      const at = inset + (side * i) / cells + 0.5;
      context.beginPath();
      context.moveTo(at, inset);
      context.lineTo(at, inset + side);
      context.moveTo(inset, at);
      context.lineTo(inset + side, at);
      context.stroke();
    }
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
