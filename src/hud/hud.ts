import { clear, el } from '../ui/dom';
import type { CameraMode } from '../scene/cameraRig';
import { RESOURCES, RESOURCE_KINDS, inventoryValue, type Inventory } from '../game/loot';
import { fromMapCoords, headingBearing, toMapCoords, worldVectorToMap } from '../game/mapCoords';
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
  readonly message: string | null;
  readonly weapons: readonly WeaponGroupReadout[];
  readonly cargo: Inventory;
  readonly pixelLevel: number;
  readonly pixelScope: PixelScope;
  readonly beacons: ReadonlyArray<{ readonly x: number; readonly z: number; readonly colour: string }>;
  readonly hazards: ReadonlyArray<{ readonly x: number; readonly z: number; readonly radius: number; readonly colour: string }>;
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
}

const MINIMAP_SIZE = 220;
/** Margin band around the map square where the compass letters sit. */
const MINIMAP_MARGIN = 16;
/** Side of the map square; the whole map always fits, north up. */
const MAP_SIDE = MINIMAP_SIZE - MINIMAP_MARGIN * 2;
const MINIMAP_GRID = 4;

/** DOM overlay for flight: readouts, camera toggle, controls hint and a minimap. */
export class FlightHud {
  private readonly readout: HTMLElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly minimap: HTMLCanvasElement;
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
    this.readout = el('div', { className: 'hud-readout' });
    this.cameraButton = el('button', { type: 'button', text: 'Camera: perspective' });
    this.cameraButton.addEventListener('click', actions.onToggleCamera);
    const exit = el('button', { type: 'button', text: 'Back to hangar (Esc)', className: 'primary' });
    exit.addEventListener('click', actions.onExit);
    this.pixelSelect = el('select', { title: 'Pixelation level (P)' });
    PIXEL_LEVELS.forEach((level, index) => this.pixelSelect.append(el('option', { value: String(index), text: `Pixels: ${level.label}` })));
    this.pixelSelect.addEventListener('change', () => actions.onPixelLevel(Number(this.pixelSelect.value)));
    this.scopeSelect = el('select', { title: 'What gets pixelated (O)' });
    this.scopeSelect.append(el('option', { value: '3d', text: '3D only' }), el('option', { value: 'all', text: 'Everything' }));
    this.scopeSelect.addEventListener('change', () => actions.onPixelScope(this.scopeSelect.value as PixelScope));
    this.minimap = el('canvas', { className: 'hud-minimap', title: 'Click to warp there' });
    this.minimap.width = MINIMAP_SIZE;
    this.minimap.height = MINIMAP_SIZE;
    this.minimap.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.halfExtent <= 0) return;
      const rect = this.minimap.getBoundingClientRect();
      const mx = ((event.clientX - rect.left) / rect.width) * MINIMAP_SIZE;
      const mz = ((event.clientY - rect.top) / rect.height) * MINIMAP_SIZE;
      // The map square maps straight onto map coordinates (x grows right, y
      // grows up, (0, 0) bottom-left). Clicks in the margin are ignored.
      const u = (mx - MINIMAP_MARGIN) / MAP_SIDE;
      const v = (mz - MINIMAP_MARGIN) / MAP_SIDE;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      const mapX = u * 2 * this.halfExtent;
      const mapY = (1 - v) * 2 * this.halfExtent;
      const world = fromMapCoords(mapX, mapY, this.halfExtent);
      actions.onTeleport(world.x, world.z);
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
      el('div', { className: 'hud hud-top-left' }, [this.readout]),
      el('div', { className: 'hud hud-top-right' }, [this.pixelSelect, this.scopeSelect, this.cameraButton, exit]),
      el('div', { className: 'hud hud-bottom-left muted' }, [
        el('div', { text: 'W A S D thrust and strafe · mouse aims · click fires the selected weapon group · 1 / 2 / 3 switch group' }),
        el('div', { text: 'Shift boost · wheel zoom · Q / E tilt camera · C camera mode · P pixelation · O pixel scope · click minimap to warp · Esc back' }),
      ]),
      el('div', { className: 'hud hud-bottom-right' }, [this.minimap]),
    );
  }

  update(info: HudInfo): void {
    const here = toMapCoords(info.x, info.z, info.halfExtent);
    this.readout.replaceChildren(
      el('div', { text: `speed ${info.speed.toFixed(0)}` }),
      el('div', { text: `x ${here.x.toFixed(0)}  y ${here.y.toFixed(0)}  hdg ${headingBearing(info.heading).toFixed(0).padStart(3, '0')}°` }),
      el('div', { className: 'muted', text: `${info.mode} · tilt ${info.tiltDegrees.toFixed(0)}° · zoom ${info.zoomDistance.toFixed(0)}` }),
      el('div', { text: `rocks broken ${info.rocksBroken} · kills ${info.kills} · deaths ${info.deaths}` }),
      el('div', { className: 'hud-cargo' }, [
        el('span', { text: 'cargo ' }),
        ...RESOURCE_KINDS.map((kind) =>
          el('span', { className: 'cargo-item', style: { color: RESOURCES[kind].colour } }, [`${RESOURCES[kind].label.toLowerCase()} ${info.cargo[kind]} `]),
        ),
        el('span', { className: 'muted', text: ` · worth ${inventoryValue(info.cargo)}` }),
      ]),
      el('div', {
        className: 'muted',
        text: info.enemies[0] ? `enemy ${Math.hypot(info.enemies[0].x - info.x, info.enemies[0].z - info.z).toFixed(0)} away` : 'no enemies up',
      }),
      el('div', {
        className: 'hud-comet',
        text: info.comet
          ? `comet ${Math.hypot(info.comet.x - info.x, info.comet.z - info.z).toFixed(0)} away · ${Math.ceil(info.comet.hp)} / ${info.comet.maxHp} hp`
          : 'no comet in the sector',
      }),
    );
    this.message.textContent = info.message ?? '';
    this.message.style.display = info.message ? '' : 'none';
    this.updateWeapons(info.weapons);
    this.cameraButton.textContent = `Camera: ${info.mode}`;
    if (this.pixelSelect.value !== String(info.pixelLevel)) this.pixelSelect.value = String(info.pixelLevel);
    if (this.scopeSelect.value !== info.pixelScope) this.scopeSelect.value = info.pixelScope;
    this.drawMinimap(info);
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

  private drawMinimap(info: HudInfo): void {
    this.halfExtent = info.halfExtent;
    const context = this.minimap.getContext('2d');
    if (!context) return;
    const size = MINIMAP_SIZE;
    const origin = MINIMAP_MARGIN;
    const scale = MAP_SIDE / (2 * info.halfExtent);
    const toMap = (x: number, z: number): [number, number] => {
      const point = toMapCoords(x, z, info.halfExtent);
      return [origin + point.x * scale, origin + MAP_SIDE - point.y * scale];
    };
    const dir = (worldX: number, worldZ: number): readonly [number, number] => {
      const [mx, my] = worldVectorToMap(worldX, worldZ);
      return [mx, -my];
    };

    context.clearRect(0, 0, size, size);
    // Panel.
    context.fillStyle = 'rgba(10, 12, 20, 0.78)';
    roundedRect(context, 0.5, 0.5, size - 1, size - 1, 6);
    context.fill();
    context.strokeStyle = 'rgba(140, 150, 170, 0.45)';
    context.lineWidth = 1;
    context.stroke();
    // Map square with a faint grid.
    context.fillStyle = 'rgba(18, 24, 38, 0.6)';
    context.fillRect(origin, origin, MAP_SIDE, MAP_SIDE);
    context.strokeStyle = 'rgba(120, 140, 170, 0.14)';
    for (let i = 1; i < MINIMAP_GRID; i++) {
      const at = origin + (MAP_SIDE * i) / MINIMAP_GRID + 0.5;
      context.beginPath();
      context.moveTo(at, origin);
      context.lineTo(at, origin + MAP_SIDE);
      context.moveTo(origin, at);
      context.lineTo(origin + MAP_SIDE, at);
      context.stroke();
    }
    context.strokeStyle = 'rgba(140, 150, 170, 0.7)';
    context.strokeRect(origin + 0.5, origin + 0.5, MAP_SIDE - 1, MAP_SIDE - 1);
    // Compass letters in the margins.
    context.font = 'bold 11px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const mid = origin + MAP_SIDE / 2;
    const letters: ReadonlyArray<readonly [string, number, number]> = [
      ['N', mid, origin / 2],
      ['S', mid, size - origin / 2],
      ['W', origin / 2, mid],
      ['E', size - origin / 2, mid],
    ];
    for (const [letter, lx, ly] of letters) {
      context.fillStyle = letter === 'N' ? '#6fd3ff' : 'rgba(200, 208, 220, 0.75)';
      context.fillText(letter, lx, ly);
    }

    // Everything on the map is clipped to the square.
    context.save();
    context.beginPath();
    context.rect(origin, origin, MAP_SIDE, MAP_SIDE);
    context.clip();
    context.fillStyle = 'rgba(160, 150, 140, 0.6)';
    for (const rock of info.rocks) {
      const [mx, mz] = toMap(rock.x, rock.z);
      context.fillRect(mx - 0.5, mz - 0.5, 1.5, 1.5);
    }
    context.fillStyle = 'rgba(200, 180, 140, 0.8)';
    for (const [px, pz] of info.planets) {
      const [mx, mz] = toMap(px, pz);
      context.beginPath();
      context.arc(mx, mz, 2.2, 0, Math.PI * 2);
      context.fill();
    }
    for (const hazard of info.hazards) {
      const [hx, hz] = toMap(hazard.x, hazard.z);
      const pr = Math.max(3, (hazard.radius / (2 * info.halfExtent)) * MAP_SIDE);
      context.fillStyle = hazard.colour;
      context.globalAlpha = 0.3;
      context.beginPath();
      context.arc(hx, hz, pr, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.8;
      context.lineWidth = 1;
      context.strokeStyle = hazard.colour;
      context.stroke();
      context.globalAlpha = 1;
    }
    for (const beacon of info.beacons) {
      const [bx, bz] = toMap(beacon.x, beacon.z);
      context.fillStyle = beacon.colour;
      context.beginPath();
      context.moveTo(bx, bz - 3.5);
      context.lineTo(bx + 3.5, bz);
      context.lineTo(bx, bz + 3.5);
      context.lineTo(bx - 3.5, bz);
      context.closePath();
      context.fill();
    }
    for (const enemy of info.enemies) {
      const [ex, ez] = toMap(enemy.x, enemy.z);
      context.fillStyle = '#ff5c5c';
      context.beginPath();
      context.arc(ex, ez, 3, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(255, 92, 92, 0.45)';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(ex, ez, 5.5, 0, Math.PI * 2);
      context.stroke();
    }
    if (info.comet) {
      const [cx, cz] = toMap(info.comet.x, info.comet.z);
      const speed = Math.hypot(info.comet.vx, info.comet.vz) || 1;
      const pulse = 3 + Math.sin(performance.now() / 180) * 1.2;
      const [tx, tz] = dir(info.comet.vx / speed, info.comet.vz / speed);
      context.strokeStyle = 'rgba(159, 216, 255, 0.8)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(cx, cz);
      context.lineTo(cx - tx * 12, cz - tz * 12);
      context.stroke();
      context.fillStyle = '#dff4ff';
      context.beginPath();
      context.arc(cx, cz, pulse, 0, Math.PI * 2);
      context.fill();
    }
    const [sx, sz] = toMap(info.x, info.z);
    const [hx, hz] = dir(Math.sin(info.heading), Math.cos(info.heading));
    context.strokeStyle = '#6fd3ff';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(sx, sz);
    context.lineTo(sx + hx * 8, sz + hz * 8);
    context.stroke();
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(sx, sz, 2.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
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
