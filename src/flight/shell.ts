import type { Catalog } from '../catalog/catalog';
import { EntityType, EXAMINE_OPTION, HUD_INTERFACE_IDS, INTERFACE_IDS, MAP_BUTTONS } from '../client/definitions';
import type { ClientMessage, ServerMessage } from '../client/messages';
import { pickAt, type ClientPick } from '../client/pick';
import type { ClientEntity, ClientWorld } from '../client/world';
import { optionsFor, type MenuOption, type OptionContext } from '../game/actions';
import { surfaceFor } from '../game/loadout';
import { RESOURCE_KINDS } from '../game/loot';
import type { ResolvedMap } from '../game/map';
import { WEAPON_GROUPS } from '../game/weapons';
import { HitMarkers } from '../hud/hitMarkers';
import { FlightHud } from '../hud/hud';
import { FlightInputTracker, type InputSnapshot } from '../hud/input';
import { parseInterfaceCommand, type DialogueLine } from '../hud/interfaces';
import { WorldLabels } from '../hud/labels';
import { GameScene } from '../scene/gameScene';
import { PIXEL_LEVELS, type PixelScope } from '../scene/pixelate';
import type { ShipState } from '../state/shipState';
import { applyEffects, type EffectsHost } from './effects';
import { FlightPresenter } from './presenter';

/** What a session supplies: where packets go, and how to leave. */
export interface ShellHandlers {
  onExit(): void;
  /** A packet the player's action produced: an option on something, a button, a line of chat. */
  send(message: ClientMessage): void;
}

const MAX_FRAME_DT = 0.05;
const TILT_DEGREES_PER_SECOND = 50;
const BANNER_SECONDS = 3;
/** Minimum seconds between "continue" packets while Space is held on a dialogue. */
const HOLD_SKIP_INTERVAL = 0.14;
const PIXEL_SETTINGS_KEY = 'shipyard.pixelation';

/**
 * Everything a flight has on screen and on the keyboard, whichever server
 * is on the other end: the HUD, labels, hit markers, input, the scene once
 * the sector is known, and the presenter that draws the client's world.
 * Player actions become packets through `handlers.send`; server packets
 * come back in through `applyEffects` and `applyInterface`. The session
 * only owns the frame loop and the connection.
 */
export class FlightShell {
  readonly hud: FlightHud;
  readonly labels: WorldLabels;
  readonly hitMarkers: HitMarkers;
  scene: GameScene | null = null;
  presenter: FlightPresenter | null = null;
  private input: FlightInputTracker | null = null;
  private readonly statusLine: HTMLElement;
  private bannerState: { readonly text: string; readonly until: number } | null = null;
  private hovered: ClientPick = null;
  private talkable: ClientEntity | null = null;
  private lastResumeAt = -Infinity;
  private localTime = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly catalog: Catalog,
    readonly world: ClientWorld,
    private readonly handlers: ShellHandlers,
  ) {
    container.replaceChildren();
    const labelRoot = document.createElement('div');
    labelRoot.className = 'flight-labels';
    const hudRoot = document.createElement('div');
    hudRoot.className = 'flight-hud';
    this.statusLine = document.createElement('div');
    this.statusLine.className = 'flight-status';
    this.statusLine.style.display = 'none';
    container.append(labelRoot, hudRoot, this.statusLine);
    this.labels = new WorldLabels(labelRoot);
    this.hitMarkers = new HitMarkers(labelRoot);
    this.hud = new FlightHud(hudRoot, {
      onExit: () => this.handlers.onExit(),
      onToggleCamera: () => this.scene?.camera.toggleMode(),
      onPixelLevel: (index) => this.setPixelation(index, this.scene?.pixelScope ?? '3d'),
      onPixelScope: (scope) => this.setPixelation(this.scene?.pixelLevel ?? 0, scope),
      onMapClick: (x, z) => this.unlessTalking(() => this.handlers.send({ type: 'move-minimap-click', x, z })),
      onWarp: () => this.unlessTalking(() => this.engageWarp()),
      onChatSend: (text) => this.chatSend(text),
      onItemMenu: (target, x, y, defaultOnly) => {
        const context: OptionContext =
          target.kind === 'inventory' ? { kind: 'held', item: target.item, count: target.count, slot: RESOURCE_KINDS.indexOf(target.item) } : { kind: 'equipped', itemId: target.itemId, group: target.group };
        const options = optionsFor(context);
        if (defaultOnly) {
          if (options[0]) this.handlers.send(options[0].message);
        } else this.openMenu(options, x, y);
      },
    });
  }

  // ---- lifecycle -------------------------------------------------------------------

  /** A line over the dark screen before the sector is up ("Connecting…"), or null to hide it. */
  setStatus(text: string | null): void {
    this.statusLine.textContent = text ?? '';
    this.statusLine.style.display = text ? '' : 'none';
  }

  /** Build the scene for a sector and start taking input. Call once the map and the player's build are known. */
  openSector(map: ResolvedMap, playerBuild: ShipState): void {
    if (this.scene) return;
    const scene = new GameScene(this.container, { seed: map.seed, halfExtent: map.halfExtent, boundaryColour: playerBuild.colours.trim, scenery: map.scenery });
    // The scene appends its canvas after the overlays; put it underneath them.
    this.container.prepend(this.container.lastElementChild!);
    scene.setBeacons(map.beacons);
    scene.setHazards(map.hazards);
    this.scene = scene;
    this.presenter = new FlightPresenter(scene, this.hud, this.labels, this.hitMarkers, this.world, this.catalog);
    this.effectsHost = {
      scene,
      hitMarkers: this.hitMarkers,
      world: this.world,
      say: (text) => this.say(text),
      banner: (text) => this.banner(text),
      chat: (entity, text) => this.chat(entity, text),
      snapCamera: (x, z) => this.snapCamera(x, z),
      accentFor: (entity) => this.accentFor(entity),
    };
    this.loadPixelSettings();
    this.input = new FlightInputTracker(scene.surface, {
      // Esc closes whatever is open first (menu, dialogue, window); with nothing open it brings up the settings window.
      onExit: () => this.escape(),
      // While talking, only Space (continue) and Esc (close) do anything.
      onToggleCamera: () => this.unlessTalking(() => scene.camera.toggleMode()),
      onToggleMap: () => this.unlessTalking(() => this.hud.setMapExpanded(!this.hud.mapExpanded)),
      onWarp: () => this.unlessTalking(() => this.engageWarp()),
      onInteract: (repeat) => this.interact(repeat),
      onChatFocus: () => this.unlessTalking(() => this.hud.chat.focusInput()),
      onContextMenu: (px) => this.unlessTalking(() => this.contextMenuAt(px)),
      onTap: () => this.unlessTalking(() => this.tapAt()),
      onZoom: (factor) => this.unlessTalking(() => scene.camera.zoomBy(factor)),
      onSelectGroup: (index) => {
        if (WEAPON_GROUPS[index]) this.unlessTalking(() => this.handlers.send({ type: 'if-button', interfaceId: HUD_INTERFACE_IDS.weapons, button: index + 1 }));
      },
      onCyclePixelation: () => this.unlessTalking(() => this.setPixelation((scene.pixelLevel + 1) % PIXEL_LEVELS.length, scene.pixelScope)),
      onTogglePixelScope: () => this.unlessTalking(() => this.setPixelation(scene.pixelLevel, scene.pixelScope === '3d' ? 'all' : '3d')),
    });
    this.input.attach();
    scene.camera.snapTo(map.spawn.x, map.spawn.z);
    this.hud.setItemIcons(scene.itemIconUrls());
    if (this.catalog.findHull(playerBuild.hullId)) {
      this.hud.setShipPortrait(scene.shipPortrait(surfaceFor(playerBuild, this.catalog), playerBuild.colours, playerBuild.material, (url) => !this.disposed && this.hud.setShipPortrait(url)));
    }
    this.banner(map.name);
    this.setStatus(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hud.dispose();
    this.input?.detach();
    this.labels.dispose();
    this.hitMarkers.dispose();
    this.scene?.dispose();
    this.container.replaceChildren();
  }

  // ---- per frame -------------------------------------------------------------------

  /** Clamp a frame's elapsed time the way the loop expects it. */
  static frameDt(nowMs: number, lastMs: number): number {
    return Math.min(MAX_FRAME_DT, Math.max(0, (nowMs - lastMs) / 1000));
  }

  /** This frame's keyboard and pointer state, or null before the sector is up. */
  pollInput(): InputSnapshot | null {
    const scene = this.scene;
    if (!scene || !this.input) return null;
    const snapshot = this.input.snapshot((x, y) => scene.aimPoint(x, y));
    this.hovered = snapshot.flight.aim ? pickAt(this.world, snapshot.flight.aim[0], snapshot.flight.aim[1]) : null;
    return snapshot;
  }

  /** Draw the world as it stands. `cameraTilt` is the Q/E request from the input snapshot. */
  present(dt: number, time: number, cameraTilt: number, pointerPx: { readonly x: number; readonly y: number } | null): void {
    const { scene, presenter } = this;
    if (!scene || !presenter) return;
    this.localTime = time;
    if (cameraTilt !== 0) scene.camera.tiltBy(cameraTilt * TILT_DEGREES_PER_SECOND * dt);
    if (this.bannerState && time > this.bannerState.until) this.bannerState = null;
    this.talkable = this.findTalkable();
    presenter.frame({ dt, time, hovered: this.hovered, pointerPx, banner: this.bannerState?.text ?? null, talkable: this.talkable, dialogueOpen: this.hud.chat.dialogueOpen });
  }

  // ---- server packets in ------------------------------------------------------------

  applyEffects(message: ServerMessage): void {
    if (this.effectsHost) applyEffects(this.effectsHost, message);
  }

  /** Windows the server opens, closes and fills, including the dialogue box. */
  applyInterface(message: ServerMessage): void {
    switch (message.type) {
      case 'if-opensub':
        if (message.id === HUD_INTERFACE_IDS.dialogue) this.openDialogueLine(message.props);
        else this.hud.interfaces.open(message.id, message.props);
        return;
      case 'if-closesub':
        if (message.id === HUD_INTERFACE_IDS.dialogue) this.hud.chat.closeDialogue();
        else this.hud.interfaces.close(message.id);
        return;
      case 'if-setprops':
        if (message.id === HUD_INTERFACE_IDS.dialogue) this.openDialogueLine(message.props);
        else this.hud.interfaces.setProps(message.id, message.props);
        return;
      default:
        return;
    }
  }

  private openDialogueLine(props: Readonly<Record<string, unknown>>): void {
    const speaker = typeof props['speaker'] === 'string' ? props['speaker'] : '';
    const text = typeof props['text'] === 'string' ? props['text'] : '';
    const portrait = typeof props['portrait'] === 'string' && props['portrait'] ? props['portrait'] : undefined;
    const line: DialogueLine = portrait ? { speaker, text, portrait } : { speaker, text };
    this.hud.chat.openDialogue({ lines: [line] });
  }

  // ---- effects host ------------------------------------------------------------------

  private effectsHost: EffectsHost | null = null;

  say(text: string): void {
    this.hud.chat.addMessage({ from: '', kind: 'system', text });
  }

  banner(text: string): void {
    this.bannerState = { text, until: this.localTime + BANNER_SECONDS };
  }

  chat(entity: ClientEntity, text: string): void {
    const name = entity.appearance?.name ?? '?';
    this.hud.chat.addMessage({ from: name, text, kind: 'player' });
    this.labels.say(String(entity.index), text, this.accentFor(entity));
  }

  snapCamera(x: number, z: number): void {
    this.scene?.camera.snapTo(x, z);
  }

  accentFor(entity: ClientEntity): string {
    return this.presenter?.accentFor(entity) ?? '#ffffff';
  }

  // ---- player actions ----------------------------------------------------------------

  private get inDialogue(): boolean {
    return this.hud.chat.dialogueOpen;
  }

  private unlessTalking(action: () => void): void {
    if (!this.inDialogue) action();
  }

  /** Esc: close the topmost thing, telling the server when it was a window; with nothing open, the settings. */
  private escape(): void {
    if (this.hud.menuOpen) {
      this.hud.closeMenu();
      return;
    }
    if (this.inDialogue) {
      this.hud.chat.closeDialogue();
      this.handlers.send({ type: 'close-modal', interfaceId: HUD_INTERFACE_IDS.dialogue });
      return;
    }
    const closed = this.hud.interfaces.closeTopmost();
    if (closed) this.handlers.send({ type: 'close-modal', interfaceId: closed.id });
    else this.hud.openSettings();
  }

  /** Space: continue an open dialogue (finishing the typing first), or talk to the ship in range. */
  private interact(repeat: boolean): void {
    const state = this.hud.chat.dialogue.get();
    if (state) {
      if (state.typing) {
        this.hud.chat.advanceDialogue(repeat);
        return;
      }
      if (repeat && this.localTime - this.lastResumeAt < HOLD_SKIP_INTERVAL) return;
      this.lastResumeAt = this.localTime;
      this.handlers.send({ type: 'resume-pause-button', interfaceId: HUD_INTERFACE_IDS.dialogue });
      return;
    }
    if (repeat || !this.talkable) return;
    this.handlers.send({ type: 'op-npc', option: 1, index: this.talkable.index });
  }

  /** The warp button or J: the server warps to the map flag, or says why not. */
  private engageWarp(): void {
    this.handlers.send({ type: 'if-button', interfaceId: INTERFACE_IDS.map, button: MAP_BUTTONS.warp });
    this.hud.setMapExpanded(false);
  }

  /** A line typed in the chat box: a local command, a server command, or something said out loud. */
  private chatSend(text: string): void {
    if (!text.startsWith('/')) {
      this.handlers.send({ type: 'message-public', text });
      return;
    }
    const body = text.slice(1);
    const [command = '', ...args] = body.split(/\s+/);
    if (command.toLowerCase() === 'help') {
      this.hud.openSettings('controls');
      return;
    }
    if (command.toLowerCase() === 'ui' && parseInterfaceCommand(args) === 'list') {
      for (const info of this.hud.interfaces.list()) this.say(`#${info.id} ${info.name} · ${info.slot}${info.open ? ' · open' : ''}`);
      return;
    }
    this.handlers.send({ type: 'client-cheat', text: body });
  }

  /** The nearest living NPC ship with something to say, within its talking range of the player. */
  private findTalkable(): ClientEntity | null {
    const player = this.world.player;
    if (!player?.alive) return null;
    let best: ClientEntity | null = null;
    let bestDistance = Infinity;
    for (const entity of this.world.entities.values()) {
      const appearance = entity.appearance;
      if (entity.kind !== 'npc' || !entity.alive || !appearance || appearance.talkRange === null || appearance.entityType !== EntityType.SHIP) continue;
      const distance = Math.hypot(entity.pose.x - player.pose.x, entity.pose.z - player.pose.z);
      if (distance <= appearance.talkRange && distance < bestDistance) {
        best = entity;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Build the option context for whatever is under the pointer. */
  private optionContextAt(pick: ClientPick): OptionContext | null {
    if (!pick) return null;
    switch (pick.kind) {
      case 'entity': {
        const { entity } = pick;
        const appearance = entity.appearance;
        if (!appearance) return null;
        if (entity.kind === 'player') return { kind: 'player', index: entity.index, name: appearance.name, isSelf: entity.index === this.world.playerIndex };
        return { kind: 'npc', index: entity.index, entityType: appearance.entityType, name: appearance.name, inTalkRange: this.talkable === entity };
      }
      case 'rock':
        return { kind: 'rock', rock: pick.rock };
      case 'obj':
        return { kind: 'obj', item: pick.item };
      case 'beacon':
        return { kind: 'beacon', beacon: pick.beacon };
      case 'hazard':
        return { kind: 'hazard', hazard: pick.hazard };
    }
  }

  private contextMenuAt(px: { readonly x: number; readonly y: number }): void {
    const context = this.optionContextAt(this.hovered);
    if (!context || !this.scene) return;
    const rect = this.scene.surface.getBoundingClientRect();
    this.openMenu(optionsFor(context), rect.left + px.x, rect.top + px.y);
  }

  private openMenu(options: readonly MenuOption[], x: number, y: number): void {
    if (options.length === 0) return;
    this.hud.openMenu({
      x,
      y,
      options: options.map((option) => ({ label: option.label, target: option.target })),
      onPick: (index) => {
        const chosen = options[index];
        if (chosen) this.handlers.send(chosen.message);
      },
    });
  }

  /** A quick click on something performs its default option. Examine is never a default. */
  private tapAt(): void {
    if (this.hud.menuOpen) return;
    const context = this.optionContextAt(this.hovered);
    const first = context ? optionsFor(context)[0] : undefined;
    if (first && !('option' in first.message && first.message.option === EXAMINE_OPTION)) this.handlers.send(first.message);
  }

  // ---- settings ------------------------------------------------------------------------

  private setPixelation(level: number, scope: PixelScope): void {
    const scene = this.scene;
    if (!scene) return;
    scene.setPixelation(level, scope);
    try {
      window.localStorage.setItem(PIXEL_SETTINGS_KEY, JSON.stringify({ level: scene.pixelLevel, scope }));
    } catch {
      // Storage may be unavailable; the setting just will not persist.
    }
  }

  private loadPixelSettings(): void {
    const scene = this.scene;
    if (!scene) return;
    try {
      const raw = window.localStorage.getItem(PIXEL_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { level?: unknown; scope?: unknown };
      const level = typeof parsed.level === 'number' ? parsed.level : scene.pixelLevel;
      const scope = parsed.scope === '3d' || parsed.scope === 'all' ? parsed.scope : scene.pixelScope;
      scene.setPixelation(level, scope);
    } catch {
      // Ignore malformed or unavailable storage.
    }
  }
}
