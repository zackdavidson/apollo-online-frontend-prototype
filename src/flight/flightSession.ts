import { meshBounds, type SurfaceMesh } from '../core/mesh';
import type { MaterialId } from '../core/materials';
import type { ShipColours } from '../core/palette';
import { COMBAT_TUNING } from '../game/combat';
import { COMET_RESOURCES } from '../game/comet';
import { TurretAi, type ShipController } from '../game/controllers';
import { formatHit } from '../game/damageRoll';
import type { GameEvent } from '../game/events';
import { speedOf, type FlightInput } from '../game/flightController';
import { optionsFor, type GameAction, type OptionContext } from '../game/actions';
import { defaultItemCatalog } from '../game/items';
import { RESOURCES } from '../game/loot';
import { freshTalents, talentReadouts } from '../game/talents';
import { defaultResolvedMap, type ResolvedMap } from '../game/map';
import { formatMapCoords, toMapCoords } from '../game/mapCoords';
import { shipToWorld, type WeaponMount } from '../game/projectiles';
import { ROCK_KINDS, rockDropItems, type Rock } from '../game/rocks';
import { WorldSim } from '../game/simulation';
import { sampleWarp } from '../game/warp';
import { WEAPON_GROUPS, type WeaponGroup } from '../game/weapons';
import type { Pick, ShipEntity, ShipId, Stance } from '../game/world';
import { HitMarkers, type HitStyle } from '../hud/hitMarkers';
import { parseInterfaceCommand, type DialogueLine, type InterfaceCommand } from '../hud/interfaces';
import { FlightHud, type HudInfo } from '../hud/hud';
import { FlightInputTracker } from '../hud/input';
import { WorldLabels } from '../hud/labels';
import type { BeamVisual } from '../scene/beamRenderer';
import { GameScene, type ChargeGlow } from '../scene/gameScene';
import type { BarEntry } from '../scene/healthBars';
import { PIXEL_LEVELS, type PixelScope } from '../scene/pixelate';
import { rockTop } from '../scene/rockRenderer';

/** A ship as the hangar hands it over: looks plus loadout. */
export interface SessionShip {
  readonly name: string;
  readonly hullName: string;
  readonly surface: SurfaceMesh;
  readonly colours: ShipColours;
  /** Finish over the paint (core/materials.ts); plain when omitted. */
  readonly material?: MaterialId | undefined;
  readonly weaponMounts: readonly WeaponMount[];
}

/** An NPC to drop into the world. Sensible combat defaults; override what you need. */
export interface NpcSpawn extends SessionShip {
  readonly x: number;
  readonly z: number;
  readonly heading?: number;
  readonly team?: string;
  readonly maxShield?: number;
  readonly maxHull?: number;
  readonly respawnDelay?: number | null;
  readonly damageScale?: number;
  readonly controller?: ShipController;
  readonly accent?: string;
  /** Friendly ships hold fire and are not shown as enemies until provoked (or until their AI ambushes). */
  readonly stance?: Stance;
  /** False for ships that never turn hostile when shot. */
  readonly provokable?: boolean;
  /** True for ships nothing can hurt; they also get no shield and no bars over their name. */
  readonly invulnerable?: boolean;
  /** What the ship says when you press Space next to it. */
  readonly dialogue?: NpcDialogue;
}

export interface NpcDialogue {
  /** How close (centre to centre) you must be to talk; `DEFAULT_INTERACT_RANGE` when omitted. */
  readonly range?: number;
  readonly lines: readonly DialogueLine[];
}

/** Default talking distance from the player's centre, in world units. */
export const DEFAULT_INTERACT_RANGE = 30;
/** How far beyond the hull "Take" reaches for a dropped stack. */
const TAKE_RANGE = 10;
/** Reach of the warp drive from the ship, in world units. */
export const WARP_RANGE = 1000;
/** Clicking this close to the existing waypoint clears it. */
const WAYPOINT_CLEAR_RADIUS = 8;

export interface FlightSessionOptions {
  readonly player: SessionShip;
  readonly npcs?: readonly NpcSpawn[];
  /** The sector to fly in; defaults to the starter sector. */
  readonly map?: ResolvedMap;
  readonly onExit: () => void;
}

const PLAYER_ID = 'player';
const MAX_FRAME_DT = 0.05;
const TILT_DEGREES_PER_SECOND = 50;
const LABEL_HEIGHT = 3.4;
/** How close the comet has to be before its bar shows. */
const COMET_BAR_RANGE = 440;
/** Only rocks this close to the player are pushed to the scene: the client's "in view" set a server would stream. */
const ROCK_VIEW_RADIUS = 340;
const ROCK_CHIP_COLOUR = '#9a8f80';
const MISSILE_SMOKE = '#8a8a8a';
const SHIELD_COLOUR = '#5fb4ff';
const COMET_ACCENT = '#9fd8ff';
const NPC_ACCENT = '#ff6a3a';
/** Label and tooltip colour for ships that are friendly right now. */
const FRIENDLY_ACCENT = '#7fe3a0';
const PIXEL_SETTINGS_KEY = 'shipyard.pixelation';
const ROCK_BAR_COLOURS: Readonly<Record<Rock['kind'], string>> = {
  stone: '#d9b26a',
  iron: '#9fb4c8',
  ice: '#8fe3ff',
  crystal: '#d9a6ff',
  giant: '#ff9a5a',
};

/** Hit and collision radius for a hull from its mesh. */
export function shipRadiusFor(surface: SurfaceMesh): number {
  const bounds = meshBounds(surface);
  return 0.36 * Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
}

/**
 * Runs one flight: owns the simulation, the scene, the HUD and the input,
 * and is the only place that knows about all three. Every frame it feeds
 * player input into the simulation, steps it, turns the resulting events
 * into effects and messages, and pushes the new state into the scene.
 * NPCs can be added or removed at any time through `spawnNpc`.
 */
export class FlightSession {
  readonly sim: WorldSim;
  readonly scene: GameScene;
  private readonly hud: FlightHud;
  private readonly labels: WorldLabels;
  private readonly hitMarkers: HitMarkers;
  private readonly input: FlightInputTracker;
  private readonly accents = new Map<ShipId, string>();
  /** The accent each NPC uses once hostile; friendly ships show FRIENDLY_ACCENT until then. */
  private readonly hostileAccents = new Map<ShipId, string>();
  private readonly dialogues = new Map<ShipId, NpcDialogue>();
  /** The NPC you could talk to right now, if any. */
  private talkable: ShipEntity | null = null;
  private hovered: Pick = null;
  private message: { text: string; until: number } | null = null;
  private npcCounter = 0;
  private frameHandle = 0;
  private lastTime = performance.now();
  private disposed = false;
  /** A fresh sheet until a server owns it: every talent 1/1. */
  private readonly talents = talentReadouts(freshTalents());

  constructor(
    private readonly container: HTMLElement,
    options: FlightSessionOptions,
  ) {
    container.replaceChildren();
    const map = options.map ?? defaultResolvedMap();
    this.sim = new WorldSim(map);
    this.scene = new GameScene(container, { seed: map.seed, halfExtent: map.halfExtent, boundaryColour: options.player.colours.trim, scenery: map.scenery });
    this.scene.setBeacons(map.beacons);
    this.scene.setHazards(map.hazards);
    const labelRoot = document.createElement('div');
    labelRoot.className = 'flight-labels';
    const hudRoot = document.createElement('div');
    hudRoot.className = 'flight-hud';
    container.append(labelRoot, hudRoot);
    this.labels = new WorldLabels(labelRoot);
    this.hitMarkers = new HitMarkers(labelRoot);
    this.loadPixelSettings();

    const player = options.player;
    const radius = shipRadiusFor(player.surface);
    this.sim.addShip({
      id: PLAYER_ID,
      name: player.name,
      hullName: player.hullName,
      team: 'players',
      radius,
      weaponMounts: player.weaponMounts,
      maxShield: COMBAT_TUNING.playerShield,
      maxHull: COMBAT_TUNING.playerHull,
      spawn: map.spawn,
      respawnDelay: COMBAT_TUNING.playerRespawnDelay,
      collectsLoot: true,
    });
    this.scene.addShip(PLAYER_ID, { surface: player.surface, colours: player.colours, material: player.material, accent: player.colours.trim, radius });
    this.accents.set(PLAYER_ID, player.colours.trim);
    for (const npc of options.npcs ?? []) this.spawnNpc(npc);

    this.hud = new FlightHud(hudRoot, {
      onExit: options.onExit,
      onToggleCamera: () => this.scene.camera.toggleMode(),
      onPixelLevel: (index) => this.setPixelation(index, this.scene.pixelScope),
      onPixelScope: (scope) => this.setPixelation(this.scene.pixelLevel, scope),
      onMapClick: (x, z) => this.unlessTalking(() => this.setWaypoint(x, z)),
      onWarp: () => this.unlessTalking(() => this.engageWarp()),
      onChatSend: (text) => this.chatSend(text),
      onItemMenu: (target, x, y, defaultOnly) => {
        const options = optionsFor(target);
        if (defaultOnly) {
          if (options[0]) this.runAction(options[0].action);
        } else this.openMenu(options, x, y);
      },
    });
    this.input = new FlightInputTracker(this.scene.surface, {
      // Esc closes whatever is open first (menu, dialogue, map, settings); with nothing open it brings up the settings window, which holds the way back to the hangar.
      onExit: () => {
        if (this.hud.menuOpen) this.hud.closeMenu();
        else if (this.autoMine) this.stopAutoMine('Stopped mining.');
        else if (this.hud.chat.dialogueOpen) this.hud.chat.closeDialogue();
        else if (!this.hud.interfaces.closeTopmost()) this.hud.openSettings();
      },
      // While talking, only Space (advance) and Esc (close) do anything.
      onToggleCamera: () => this.unlessTalking(() => this.scene.camera.toggleMode()),
      onToggleMap: () => this.unlessTalking(() => this.hud.setMapExpanded(!this.hud.mapExpanded)),
      onWarp: () => this.unlessTalking(() => this.engageWarp()),
      onInteract: (repeat) => this.interact(repeat),
      onChatFocus: () => this.unlessTalking(() => this.hud.chat.focusInput()),
      onContextMenu: (px) => this.unlessTalking(() => this.contextMenuAt(px)),
      onTap: (px) => this.unlessTalking(() => this.tapAt(px)),
      onZoom: (factor) => this.unlessTalking(() => this.scene.camera.zoomBy(factor)),
      onSelectGroup: (index) => {
        const group = WEAPON_GROUPS[index];
        if (group) this.unlessTalking(() => this.sim.selectWeaponGroup(PLAYER_ID, group.id));
      },
      onCyclePixelation: () => this.unlessTalking(() => this.setPixelation((this.scene.pixelLevel + 1) % PIXEL_LEVELS.length, this.scene.pixelScope)),
      onTogglePixelScope: () => this.unlessTalking(() => this.setPixelation(this.scene.pixelLevel, this.scene.pixelScope === '3d' ? 'all' : '3d')),
    });
    this.input.attach();
    this.scene.camera.snapTo(map.spawn.x, map.spawn.z);
    this.message = { text: map.name, until: 3 };
    this.hud.setItemIcons(this.scene.itemIconUrls());
    this.hud.setShipPortrait(
      this.scene.shipPortrait(player.surface, player.colours, player.material, (url) => {
        if (!this.disposed) this.hud.setShipPortrait(url);
      }),
    );
    this.hud.chat.addMessage({ from: '', kind: 'system', text: `Welcome to ${map.name}. Press Enter to chat, Space to talk to ships, /help for controls.` });
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  /** Add an NPC ship to the world and the scene. Returns its id for later removal. */
  spawnNpc(npc: NpcSpawn): ShipId {
    const id = `npc-${++this.npcCounter}`;
    const radius = shipRadiusFor(npc.surface);
    this.sim.addShip({
      id,
      name: npc.name,
      hullName: npc.hullName,
      team: npc.team ?? 'raiders',
      radius,
      weaponMounts: npc.weaponMounts,
      maxShield: npc.invulnerable ? 0 : (npc.maxShield ?? COMBAT_TUNING.enemyShield),
      maxHull: npc.maxHull ?? COMBAT_TUNING.enemyHull,
      spawn: { x: npc.x, z: npc.z, heading: npc.heading ?? Math.PI },
      respawnDelay: npc.respawnDelay === undefined ? COMBAT_TUNING.enemyRespawnDelay : npc.respawnDelay,
      tuning: { turnRate: COMBAT_TUNING.enemyTurnRate, accel: 0, strafeAccel: 0, reverseAccel: 0 },
      damageScale: npc.damageScale ?? 0.35,
      controller: npc.controller ?? new TurretAi(),
      stance: npc.stance,
      provokable: npc.provokable,
      invulnerable: npc.invulnerable,
    });
    if (npc.dialogue) this.dialogues.set(id, npc.dialogue);
    this.hostileAccents.set(id, npc.accent ?? NPC_ACCENT);
    const accent = npc.stance === 'friendly' ? FRIENDLY_ACCENT : (npc.accent ?? NPC_ACCENT);
    this.scene.addShip(id, { surface: npc.surface, colours: npc.colours, material: npc.material, accent, radius });
    this.accents.set(id, accent);
    return id;
  }

  removeShip(id: ShipId): void {
    if (id === PLAYER_ID) return;
    this.sim.removeShip(id);
    this.scene.removeShip(id);
    this.labels.remove(id);
    this.accents.delete(id);
  }

  dispose(): void {
    this.hud.dispose();
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.input.detach();
    this.labels.dispose();
    this.hitMarkers.dispose();
    this.scene.dispose();
    this.container.replaceChildren();
  }

  // ---- frame ---------------------------------------------------------------

  private readonly frame = (nowMs: number): void => {
    const dt = Math.min(MAX_FRAME_DT, (nowMs - this.lastTime) / 1000);
    this.lastTime = nowMs;
    const time = nowMs / 1000;

    // Talking or reading the map: the ship stops dead and stays put until the window closes.
    const holdForUi = this.hud.chat.dialogueOpen || this.hud.mapExpanded;
    if (holdForUi !== this.heldForUi) {
      this.heldForUi = holdForUi;
      this.sim.setHeld(PLAYER_ID, holdForUi);
    }
    const snapshot = this.input.snapshot((x, y) => this.scene.aimPoint(x, y));
    const { cameraTilt, pointerPx } = snapshot;
    const flight = this.applyAutoMine(snapshot.flight);
    this.sim.setInput(PLAYER_ID, flight);
    if (cameraTilt !== 0) this.scene.camera.tiltBy(cameraTilt * TILT_DEGREES_PER_SECOND * dt);

    for (const event of this.sim.step(dt)) this.handleEvent(event);
    this.smokeTrails();
    if (this.message && this.sim.time > this.message.until) this.message = null;

    this.hovered = flight.aim ? this.sim.pick(flight.aim[0], flight.aim[1]) : null;
    this.hud.setTooltip(this.tooltipFor(this.hovered, pointerPx));
    this.pushState(time);

    const player = this.sim.getShip(PLAYER_ID)!;
    this.scene.camera.update(player.state.x, player.state.z, player.state.vx, player.state.vz, dt);
    this.scene.update(dt, time);
    this.updateOverlays(dt, player);
    this.scene.render();
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  /** Mirror the simulation into the scene. */
  private pushState(time: number): void {
    const player = this.sim.getShip(PLAYER_ID)!;
    const projectiles = [];
    const beams: BeamVisual[] = [];
    for (const ship of this.sim.allShips()) {
      if (!this.scene.hasShip(ship.spec.id)) continue;
      const warp = ship.warp ? sampleWarp(ship.warp, this.sim.time) : null;
      const spooling = warp !== null && (warp.phase === 'charging' || warp.phase === 'entering');
      this.scene.setShipPose(ship.spec.id, {
        x: ship.state.x,
        z: ship.state.z,
        heading: ship.state.heading,
        throttle: ship.alive ? ship.state.throttle : 0,
        visible: ship.alive,
        jitter: spooling ? 0.14 * (warp?.chargeProgress ?? 0) : 0,
      });
      this.scene.setShipShield(ship.spec.id, ship.vitals.maxShield > 0 ? ship.vitals.shield / ship.vitals.maxShield : 0);
      this.scene.setShipOutlined(ship.spec.id, this.hovered?.kind === 'ship' && this.hovered.ship === ship);
      projectiles.push(...ship.pool.projectiles);
      ship.beam.shots.forEach((shot, index) =>
        beams.push({
          x0: shot.x0,
          z0: shot.z0,
          x1: shot.x1,
          z1: shot.z1,
          y: shot.y ?? 0.4,
          width: shot.width ?? 0.5,
          colour: shot.colour ?? '#7fe3ff',
          fade: Math.min(1, shot.timeLeft / shot.duration),
          style: shot.style ?? 'lance',
          seed: ship.beamSeed * 10 + index,
        }),
      );
    }
    this.scene.syncProjectiles(projectiles);
    this.scene.syncBeams(beams);
    this.scene.syncRocks(this.sim.rocks.inView(player.state.x, player.state.z, ROCK_VIEW_RADIUS), this.hovered?.kind === 'rock' ? this.hovered.rockId : null);
    this.scene.syncLoot(this.sim.loot.pickups, this.hovered?.kind === 'pickup' ? this.hovered.pickup.id : null);
    this.scene.syncComet(this.sim.comet, this.hovered?.kind === 'comet');
    this.scene.setHazardHovered(this.hovered?.kind === 'hazard' ? this.hovered.hazard.id : null);
    this.scene.setHazardFocus(player.alive ? { x: player.state.x, z: player.state.z, radius: player.spec.radius * 2.4 } : null);
    this.scene.syncHealthBars(this.healthBars(player));

    // Charge glows on the player's beam muzzles.
    const glows: ChargeGlow[] = player.alive && player.beam.charge > 0
      ? player.beamMounts.map((mount) => {
          const [x, z] = shipToWorld(player.state, mount.position);
          return { x, y: mount.position[1], z, colour: mount.weapon.colour, charge: player.beam.charge };
        })
      : [];
    this.scene.setChargeGlows(glows, time);

    // Warp blank-out follows the player's warp.
    const warp = player.warp ? sampleWarp(player.warp, this.sim.time) : null;
    this.scene.setWarpOverlay(warp?.overlay ?? 0, warp?.intensity ?? 0);
  }

  private healthBars(player: ShipEntity): BarEntry[] {
    const entries: BarEntry[] = [];
    const comet = this.sim.comet;
    if (comet.alive && Math.hypot(comet.x - player.state.x, comet.z - player.state.z) < COMET_BAR_RANGE) {
      entries.push({ x: comet.x, y: comet.radius + 2.2, z: comet.z, width: 12, height: 0.7, fraction: comet.hp / comet.maxHp, colour: COMET_ACCENT });
    }
    // Only damaged rocks carry a bar. That is a property of the rock's shared
    // state (hp below max), so every client with the rock in view shows it,
    // whoever did the shooting, and it goes away when the rock respawns.
    for (const rock of this.sim.rocks.damagedInView(player.state.x, player.state.z, ROCK_VIEW_RADIUS)) {
      entries.push({
        x: rock.x,
        y: rockTop(rock) + 0.9 + rock.radius * 0.15,
        z: rock.z,
        width: Math.min(7, Math.max(1.8, rock.radius * 1.1)),
        height: rock.kind === 'giant' ? 0.5 : 0.34,
        fraction: rock.hp / rock.maxHp,
        colour: ROCK_BAR_COLOURS[rock.kind],
      });
    }
    return entries;
  }

  /** Labels, hit markers, comet arrow and the HUD readout. */
  private updateOverlays(dt: number, player: ShipEntity): void {
    const { width, height } = this.scene.size;
    this.hitMarkers.update(dt, this.scene.camera.camera, width, height);
    for (const ship of this.sim.allShips()) {
      const own = ship.spec.id === PLAYER_ID;
      // Other ships carry a framed tag above them; your own ship just has its name hung below the hull.
      const screen = !ship.alive ? null : own ? this.scene.project(ship.state.x, 0, ship.state.z - ship.spec.radius - 1.2) : this.scene.project(ship.state.x, LABEL_HEIGHT, ship.state.z);
      this.labels.update(ship.spec.id, screen, { name: ship.spec.name, vitals: ship.vitals, accent: this.accents.get(ship.spec.id) ?? NPC_ACCENT, showBars: !ship.spec.invulnerable, own });
    }

    const comet = this.sim.comet;
    if (comet.alive) {
      const { screen, onScreen } = this.scene.projectRaw(comet.x, 0.5, comet.z);
      this.hud.setCometIndicator({ screen, onScreen, distance: Math.hypot(comet.x - player.state.x, comet.z - player.state.z), width, height });
    } else {
      this.hud.setCometIndicator(null);
    }

    const byDistance = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
      Math.hypot(a.x - player.state.x, a.z - player.state.z) - Math.hypot(b.x - player.state.x, b.z - player.state.z);
    const others = [...this.sim.allShips()].filter((ship) => ship.alive && ship.spec.team !== player.spec.team);
    if (this.waypoint && player.alive) {
      const { screen, onScreen } = this.scene.projectRaw(this.waypoint.x, 0.5, this.waypoint.z);
      this.hud.setWaypointIndicator({ screen, onScreen, distance: Math.hypot(this.waypoint.x - player.state.x, this.waypoint.z - player.state.z), width, height });
    } else {
      this.hud.setWaypointIndicator(null);
    }

    const enemies = others.filter((ship) => ship.stance === 'hostile').map((ship) => ({ x: ship.state.x, z: ship.state.z })).sort(byDistance);
    const neutrals = others.filter((ship) => ship.stance === 'friendly').map((ship) => ({ x: ship.state.x, z: ship.state.z })).sort(byDistance);
    this.hud.update({
      x: player.state.x,
      z: player.state.z,
      heading: player.state.heading,
      speed: speedOf(player.state),
      mode: this.scene.cameraMode,
      tiltDegrees: this.scene.camera.tiltDegrees,
      zoomDistance: this.scene.camera.zoomDistance,
      halfExtent: this.sim.halfExtent,
      planets: this.scene.planetPositions,
      rocks: [...this.sim.rocks.defined],
      rocksBroken: this.sim.rocks.brokenCount,
      kills: player.kills,
      deaths: player.deaths,
      enemies,
      neutrals,
      message: this.message?.text ?? (player.warp ? this.warpMessage(player) : null),
      weapons: this.sim.weaponStatus(PLAYER_ID),
      cargo: player.cargo,
      pixelLevel: this.scene.pixelLevel,
      pixelScope: this.scene.pixelScope,
      beacons: this.sim.beacons.beacons,
      hazards: this.sim.hazards.hazards,
      drops: this.sim.loot.pickups.map((pickup) => ({ x: pickup.x, z: pickup.z, kind: pickup.kind, label: pickup.count > 1 ? `${RESOURCES[pickup.kind].label} × ${pickup.count}` : RESOURCES[pickup.kind].label })),
      markers: this.sim.map.markers,
      talents: this.talents,
      mapName: this.sim.map.name,
      ship: { name: player.spec.name, hullName: player.spec.hullName, shield: player.vitals.shield, maxShield: player.vitals.maxShield, hull: player.vitals.hull, maxHull: player.vitals.maxHull },
      fitted: this.fittedItems(player),
      waypoint: this.waypoint,
      warpRange: WARP_RANGE,
      comet: comet.alive ? comet : null,
    });
    const inside = player.alive ? this.sim.hazards.insideFor(PLAYER_ID)[0] : undefined;
    this.hud.setHazardWarning(inside ? { label: inside.label, damagePerSecond: inside.damagePerSecond, colour: inside.colour } : null);

    // Who can be talked to: the nearest living ship with dialogue inside its talking range.
    this.talkable = null;
    let best = Infinity;
    for (const [id, dialogue] of this.dialogues) {
      const npc = this.sim.getShip(id);
      if (!npc || !npc.alive || !player.alive) continue;
      const distance = Math.hypot(npc.state.x - player.state.x, npc.state.z - player.state.z);
      if (distance <= (dialogue.range ?? DEFAULT_INTERACT_RANGE) && distance < best) {
        best = distance;
        this.talkable = npc;
      }
    }
    this.hud.setInteractPrompt(this.talkable && !this.hud.chat.dialogueOpen ? { key: 'Space', text: `Talk to ${this.talkable.spec.name}` } : null);
  }

  // ---- options: right-click menus, default actions, auto-mining ---------------

  private autoMine: { readonly target: { readonly kind: 'rock'; readonly rockId: string } | { readonly kind: 'comet' } } | null = null;
  /** Where the player has asked to go, set on the expanded map. */
  private waypoint: { readonly x: number; readonly z: number } | null = null;
  /** Whether the ship is currently held still for a UI reason (dialogue or the open map). */
  private heldForUi = false;

  /** Build the option context for whatever is under a world point. */
  private optionContextAt(pick: Pick): OptionContext | null {
    if (!pick) return null;
    switch (pick.kind) {
      case 'pickup':
        return { kind: 'ground', pickup: pick.pickup };
      case 'rock': {
        const rock = this.sim.rocks.get(pick.rockId);
        return rock ? { kind: 'rock', rock } : null;
      }
      case 'comet':
        return { kind: 'comet', hp: this.sim.comet.hp, maxHp: this.sim.comet.maxHp };
      case 'ship':
        return { kind: 'ship', ship: pick.ship, talkable: this.talkable === pick.ship, isPlayer: pick.ship.spec.id === PLAYER_ID };
      case 'beacon':
        return { kind: 'beacon', beacon: pick.beacon };
      case 'hazard':
        return { kind: 'hazard', hazard: pick.hazard };
    }
  }

  private contextMenuAt(px: { readonly x: number; readonly y: number }): void {
    const context = this.optionContextAt(this.hovered);
    if (!context) return;
    const rect = this.scene.surface.getBoundingClientRect();
    this.openMenu(optionsFor(context), rect.left + px.x, rect.top + px.y);
  }

  private openMenu(options: ReturnType<typeof optionsFor>, x: number, y: number): void {
    if (options.length === 0) return;
    this.hud.openMenu({ x, y, options: options.map((option) => ({ label: option.label, target: option.target })), onPick: (index) => {
      const chosen = options[index];
      if (chosen) this.runAction(chosen.action);
    } });
  }

  /** A quick click on something performs its default option; on empty space it just stops auto-mining. */
  private tapAt(_px: { readonly x: number; readonly y: number }): void {
    if (this.hud.menuOpen) return;
    const context = this.optionContextAt(this.hovered);
    const first = context ? optionsFor(context)[0] : undefined;
    if (first) this.runAction(first.action);
  }

  private say(text: string): void {
    this.hud.chat.addMessage({ from: '', kind: 'system', text });
  }

  private runAction(action: GameAction): void {
    const player = this.sim.getShip(PLAYER_ID)!;
    switch (action.type) {
      case 'examine':
        this.say(action.text);
        return;
      case 'take': {
        const pickup = this.sim.loot.get(action.pickupId);
        if (!pickup) return;
        if (!this.sim.takePickup(PLAYER_ID, action.pickupId, player.spec.radius + TAKE_RANGE)) this.say("You're too far away to take that.");
        return;
      }
      case 'drop':
        if (!this.sim.dropCargo(PLAYER_ID, action.item, action.count)) this.say("You can't drop that right now.");
        return;
      case 'select-group':
        this.sim.selectWeaponGroup(PLAYER_ID, action.group);
        return;
      case 'talk':
        if (this.talkable?.spec.id === action.shipId) this.interact(false);
        else this.say("You're too far away to talk.");
        return;
      case 'mine':
        this.startAutoMine({ kind: 'rock', rockId: action.rockId });
        return;
      case 'mine-comet':
        this.startAutoMine({ kind: 'comet' });
        return;
    }
  }

  /** A click on the expanded map: set the waypoint there, or clear it when clicking the existing one. */
  private setWaypoint(x: number, z: number): void {
    if (this.waypoint && Math.hypot(this.waypoint.x - x, this.waypoint.z - z) <= WAYPOINT_CLEAR_RADIUS) {
      this.waypoint = null;
      this.say('Waypoint cleared.');
      return;
    }
    this.waypoint = { x, z };
    const point = toMapCoords(x, z, this.sim.halfExtent);
    const distance = Math.hypot(x - this.sim.getShip(PLAYER_ID)!.state.x, z - this.sim.getShip(PLAYER_ID)!.state.z);
    this.say(`Waypoint set at ${point.x.toFixed(0)}, ${point.y.toFixed(0)} · ${distance.toFixed(0)} units away${distance > WARP_RANGE ? ` (warp range ${WARP_RANGE})` : ''}.`);
  }

  /** The warp drive button or J: jump to the waypoint if the drive can reach it. */
  private engageWarp(): void {
    const player = this.sim.getShip(PLAYER_ID)!;
    if (!this.waypoint) {
      this.say('No waypoint. Open the map (M) and click where you want to go.');
      return;
    }
    const distance = Math.hypot(this.waypoint.x - player.state.x, this.waypoint.z - player.state.z);
    if (distance > WARP_RANGE) {
      this.say(`Waypoint is ${distance.toFixed(0)} units away; the warp drive reaches ${WARP_RANGE}.`);
      return;
    }
    if (!this.sim.requestWarp(PLAYER_ID, this.waypoint.x, this.waypoint.z, WARP_RANGE)) {
      this.say('Warp drive is busy.');
      return;
    }
    this.hud.setMapExpanded(false);
  }

  /** Begin mining a rock or the comet with the beam group: the ship holds its aim and fires until done, moved, or out of range. */
  private startAutoMine(target: { readonly kind: 'rock'; readonly rockId: string } | { readonly kind: 'comet' }): void {
    const player = this.sim.getShip(PLAYER_ID)!;
    if (player.beamMounts.length === 0) {
      this.say('You have nothing to mine with. Fit a mining laser or drill.');
      return;
    }
    this.sim.selectWeaponGroup(PLAYER_ID, 'beam');
    this.autoMine = { target };
    this.say(target.kind === 'rock' ? 'You begin mining the rock.' : 'You begin mining the comet.');
  }

  private stopAutoMine(reason: string | null): void {
    if (!this.autoMine) return;
    this.autoMine = null;
    if (reason) this.say(reason);
  }

  /** While auto-mining, aim at the target and hold the trigger; any manual input or a lost target stops it. */
  private applyAutoMine(flight: FlightInput): FlightInput {
    if (!this.autoMine) return flight;
    const player = this.sim.getShip(PLAYER_ID);
    if (!player || !player.alive || player.held) {
      this.autoMine = null;
      return flight;
    }
    if (flight.thrust !== 0 || flight.strafe !== 0 || flight.fire) {
      this.stopAutoMine(null);
      return flight;
    }
    const target = this.autoMine.target;
    const point = target.kind === 'rock' ? this.sim.rocks.get(target.rockId) : this.sim.comet.alive ? this.sim.comet : null;
    if (!point || (target.kind === 'rock' && (point as Rock).hp <= 0)) {
      this.stopAutoMine(null);
      return flight;
    }
    const range = Math.max(...player.beamMounts.map((mount) => mount.weapon.range ?? 0));
    const distance = Math.hypot(point.x - player.state.x, point.z - player.state.z);
    if (distance > range) {
      this.stopAutoMine(`You need to be within ${range.toFixed(0)} units to mine that.`);
      return flight;
    }
    return { ...flight, aim: [point.x, point.z], fire: true };
  }

  /** Weapon items fitted to a ship, one entry per item with how many mounts carry it. */
  private fittedItems(ship: ShipEntity): HudInfo['fitted'] {
    const counts = new Map<string, { name: string; group: WeaponGroup; mounts: number }>();
    for (const mount of ship.spec.weaponMounts) {
      const item = defaultItemCatalog().get(mount.weapon.id);
      if (!item) continue;
      const entry = counts.get(item.id) ?? { name: item.name, group: mount.weapon.group, mounts: 0 };
      entry.mounts += 1;
      counts.set(item.id, entry);
    }
    return [...counts].map(([itemId, entry]) => ({ itemId, ...entry }));
  }

  /** Space: advance an open dialogue (held key repeats skip), or start one with the ship in range. */
  private interact(repeat: boolean): void {
    if (this.hud.chat.dialogueOpen) {
      this.hud.chat.advanceDialogue(repeat);
      return;
    }
    if (repeat || !this.talkable) return;
    const dialogue = this.dialogues.get(this.talkable.spec.id);
    if (!dialogue) return;
    // Dialogue mode: the frame loop holds the ship still while the conversation is open.
    this.hud.chat.openDialogue({ lines: dialogue.lines });
  }

  private get inDialogue(): boolean {
    return this.hud.chat.dialogueOpen;
  }

  private unlessTalking(action: () => void): void {
    if (!this.inDialogue) action();
  }

  /** What a server would call: open, close or update an interface by id. Returns an error message or null. */
  applyInterfaceCommand(command: InterfaceCommand): string | null {
    return this.hud.interfaces.apply(command);
  }

  /** A line typed in the chat box: a local command, or something said out loud over the ship. */
  private chatSend(text: string): void {
    if (text.startsWith('/')) {
      const [command = '', ...args] = text.slice(1).split(/\s+/);
      const say = (line: string): void => this.hud.chat.addMessage({ from: '', kind: 'system', text: line });
      if (command.toLowerCase() === 'help') this.hud.openSettings('controls');
      else if (command.toLowerCase() === 'ui') {
        // Stands in for the server until there is one: the same commands it will send.
        const parsed = parseInterfaceCommand(args);
        if (parsed === 'list') for (const info of this.hud.interfaces.list()) say(`#${info.id} ${info.name} · ${info.slot}${info.open ? ' · open' : ''}`);
        else if (typeof parsed === 'string') say(parsed);
        else {
          const error = this.applyInterfaceCommand(parsed);
          if (error) say(error);
        }
      } else say(`Unknown command "${text}". Try /help or /ui.`);
      return;
    }
    const player = this.sim.getShip(PLAYER_ID)!;
    this.hud.chat.addMessage({ from: player.spec.name, text, kind: 'player' });
    this.labels.say(PLAYER_ID, text, this.accents.get(PLAYER_ID) ?? NPC_ACCENT);
  }

  private warpMessage(player: ShipEntity): string | null {
    if (!player.warp) return null;
    const sample = sampleWarp(player.warp, this.sim.time);
    if (sample.phase === 'tunnel') return `In warp · ${Math.max(0, player.warp.arriveAt - this.sim.time).toFixed(1)}s`;
    if (sample.phase === 'charging' || sample.phase === 'entering') return 'Spooling warp drive';
    return null;
  }

  // ---- events --------------------------------------------------------------

  private handleEvent(event: GameEvent): void {
    const now = this.sim.time;
    switch (event.type) {
      case 'shot-fired':
        this.scene.flash(event.x, event.z, event.weapon.muzzleFlash);
        return;
      case 'projectile-expired':
        if (event.weapon.kind === 'flak') {
          this.scene.flash(event.x, event.z, 1.3);
          this.scene.burst(event.x, event.z, 4, 5, event.weapon.colour);
        }
        return;
      case 'beam-fired':
        for (const shot of event.shots) {
          this.scene.flash(shot.x0, shot.z0, event.weapon.muzzleFlash);
          this.scene.burst(shot.x1, shot.z1, 10, 9, event.weapon.colour);
          if (event.weapon.beamStyle === 'siege') {
            this.scene.shockwave(shot.x0, shot.z0, 4, event.weapon.colour);
            this.scene.shockwave(shot.x1, shot.z1, 6, event.weapon.colour);
          }
        }
        return;
      case 'hit': {
        const style: HitStyle =
          event.target.kind === 'ship' ? (event.target.shipId === PLAYER_ID ? 'incoming' : event.absorbed ? 'shield' : 'hull') : 'rock';
        if (event.amount > 0) this.hitMarkers.spawn(event.x, 1.2, event.z, formatHit(event.amount), style, event.kind);
        return;
      }
      case 'ship-damaged': {
        if (event.shieldAbsorbed > 0) this.scene.shipShieldHit(event.shipId, event.x, event.z);
        this.scene.flash(event.x, event.z, event.hullDamage > 0 ? 2.4 : 1.6);
        if (event.hullDamage > 0) this.scene.burst(event.x, event.z, 8, 9, this.scene.shipColours(event.shipId)?.trim ?? '#ffffff');
        return;
      }
      case 'ship-collided':
        this.hitMarkers.spawn(event.x, 1.2, event.z, formatHit(event.damage), event.shipId === PLAYER_ID ? 'incoming' : 'hull', 'normal');
        return;
      case 'ship-destroyed': {
        const colours = this.scene.shipColours(event.shipId);
        const ship = this.sim.getShip(event.shipId);
        this.scene.explode(event.x, event.z, ship?.spec.radius ?? 3, colours?.main ?? '#888888', this.accents.get(event.shipId) ?? NPC_ACCENT);
        this.message =
          event.shipId === PLAYER_ID
            ? { text: 'Ship destroyed. Respawning...', until: now + COMBAT_TUNING.playerRespawnDelay }
            : { text: `${ship?.spec.name ?? 'Enemy'} destroyed`, until: now + 3 };
        this.hud.chat.addMessage({ from: '', kind: 'system', text: event.shipId === PLAYER_ID ? 'Your ship was destroyed.' : `${ship?.spec.name ?? 'Enemy'} destroyed.` });
        return;
      }
      case 'ship-respawned': {
        const radius = this.sim.getShip(event.shipId)?.spec.radius ?? 3;
        this.scene.flash(event.x, event.z, radius * 3);
        this.scene.shockwave(event.x, event.z, radius * 3, SHIELD_COLOUR);
        if (event.shipId === PLAYER_ID) this.scene.camera.snapTo(event.x, event.z);
        return;
      }
      case 'ship-removed':
        this.scene.removeShip(event.shipId);
        this.labels.remove(event.shipId);
        return;
      case 'rock-damaged':
        this.scene.burst(event.x, event.z, 6, 7, chipColour(event.rock));
        this.scene.flash(event.x, event.z, 1.6);
        return;
      case 'rock-destroyed': {
        const rock = event.rock;
        this.scene.burst(rock.x, rock.z, 14 + Math.round(rock.radius * 6), 6 + rock.radius * 2, chipColour(rock));
        this.scene.flash(rock.x, rock.z, rock.radius * 2.5);
        if (rock.radius > 3) this.scene.shockwave(rock.x, rock.z, rock.radius * 3, '#c9b89a');
        return;
      }
      case 'rock-respawned':
        this.scene.flash(event.rock.x, event.rock.z, event.rock.radius * 1.5);
        return;
      case 'comet-damaged':
        this.scene.flash(event.x, event.z, 1.8);
        this.scene.burst(event.x, event.z, 6, 8, COMET_ACCENT);
        return;
      case 'comet-chunk':
        this.scene.flash(event.x, event.z, 3);
        return;
      case 'comet-destroyed':
        this.scene.burst(event.x, event.z, 120, 30, COMET_ACCENT);
        this.scene.burst(event.x, event.z, 60, 18, '#ffffff');
        this.scene.flash(event.x, event.z, event.radius * 6);
        this.scene.shockwave(event.x, event.z, event.radius * 4, COMET_ACCENT);
        this.message = { text: 'Comet mined out', until: now + 3 };
        return;
      case 'comet-entered':
        this.message = { text: 'A comet has entered the sector', until: now + 4 };
        return;
      case 'comet-left':
        this.message = { text: 'The comet has left the sector', until: now + 3 };
        return;
      case 'pickup-dropped':
        if (event.shipId === PLAYER_ID) this.hud.chat.addMessage({ from: '', kind: 'system', text: `Dropped ${RESOURCES[event.kind].label} × ${event.count}.` });
        return;
      case 'pickup-collected': {
        if (event.shipId !== PLAYER_ID) return;
        const player = this.sim.getShip(PLAYER_ID)!;
        this.scene.flash(player.state.x, player.state.z, 1.4);
        this.scene.burst(player.state.x, player.state.z, 5, 6, RESOURCES[event.kind].colour);
        if (event.kind === 'crystal') this.message = { text: `+${event.count} crystal`, until: now + 1.5 };
        return;
      }
      case 'warp-started': {
        const radius = this.sim.getShip(event.shipId)?.spec.radius ?? 3;
        this.scene.shockwave(event.x, event.z, radius * 2.5, SHIELD_COLOUR);
        return;
      }
      case 'warp-blanked':
        if (event.shipId === PLAYER_ID) this.scene.camera.snapTo(event.x, event.z);
        return;
      case 'warp-arrived': {
        if (event.shipId === PLAYER_ID && this.waypoint && Math.hypot(this.waypoint.x - event.x, this.waypoint.z - event.z) < 6) this.waypoint = null;
        const radius = this.sim.getShip(event.shipId)?.spec.radius ?? 3;
        this.scene.flash(event.x, event.z, radius * 3.5);
        this.scene.shockwave(event.x, event.z, radius * 3, SHIELD_COLOUR);
        if (event.shipId === PLAYER_ID) this.message = { text: `Arrived at ${formatMapCoords(event.x, event.z, this.sim.halfExtent)}`, until: now + 2.5 };
        return;
      }
      case 'warp-done':
        return;
      case 'beacon-reached':
        this.scene.flash(event.beacon.x, event.beacon.z, event.beacon.radius * 0.6);
        this.scene.shockwave(event.beacon.x, event.beacon.z, event.beacon.radius * 1.6, event.beacon.colour);
        if (event.shipId === PLAYER_ID) {
          this.message = { text: `Reached ${event.beacon.label}`, until: now + 3 };
          this.hud.chat.addMessage({ from: '', kind: 'system', text: `Reached ${event.beacon.label}.` });
        }
        return;
      case 'ship-stance-changed': {
        const ship = this.sim.getShip(event.shipId);
        this.accents.set(event.shipId, event.stance === 'hostile' ? (this.hostileAccents.get(event.shipId) ?? NPC_ACCENT) : FRIENDLY_ACCENT);
        if (ship && event.stance === 'hostile') {
          this.scene.shockwave(ship.state.x, ship.state.z, ship.spec.radius * 2.5, NPC_ACCENT);
          const text = event.reason === 'provoked' ? `${ship.spec.name} turns hostile!` : `${ship.spec.name} opens fire!`;
          this.message = { text, until: now + 2.5 };
          this.hud.chat.addMessage({ from: '', kind: 'system', text });
        }
        return;
      }
      case 'hazard-entered':
        if (event.shipId === PLAYER_ID) {
          this.message = { text: `Entering ${event.hazard.label}`, until: now + 1.8 };
          this.hud.chat.addMessage({ from: '', kind: 'system', text: `Entering ${event.hazard.label}: ${event.hazard.damagePerSecond} damage a second.` });
        }
        return;
      case 'hazard-left':
        return;
      case 'hazard-damage':
        this.hitMarkers.spawn(event.x, 1.2, event.z, formatHit(event.amount), event.shipId === PLAYER_ID ? 'incoming' : 'hull', 'normal');
        this.scene.burst(event.x, event.z, 3, 4, event.hazard.colour);
        return;
    }
  }

  /** Missiles leave a thin smoke trail: one slow grey chip per frame. */
  private smokeTrails(): void {
    for (const ship of this.sim.allShips()) {
      for (const p of ship.pool.projectiles) {
        if (p.weapon.trail) this.scene.burst(p.x, p.z, 1, 1.2, MISSILE_SMOKE);
      }
    }
  }

  // ---- tooltips and settings ----------------------------------------------

  private tooltipFor(pick: Pick, pointerPx: { x: number; y: number } | null): Parameters<FlightHud['setTooltip']>[0] {
    if (!pick || !pointerPx) return null;
    if (pick.kind === 'ship') {
      const { spec, vitals, stance } = pick.ship;
      const stanceLine = spec.id === PLAYER_ID ? [] : [stance === 'friendly' ? (spec.provokable === false ? 'friendly' : 'friendly · will turn on you if attacked') : 'hostile'];
      const vitalsLines = spec.invulnerable ? ['cannot be harmed'] : [`shield ${Math.ceil(vitals.shield)} / ${vitals.maxShield}`, `hull ${Math.ceil(vitals.hull)} / ${vitals.maxHull}`];
      return {
        title: spec.name,
        lines: [spec.hullName, ...stanceLine, ...vitalsLines],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: this.accents.get(spec.id) ?? NPC_ACCENT,
      };
    }
    if (pick.kind === 'beacon') {
      return {
        title: pick.beacon.label,
        lines: [pick.beacon.description || 'beacon', 'fly through to activate'],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: pick.beacon.colour,
      };
    }
    if (pick.kind === 'comet') {
      const comet = this.sim.comet;
      return {
        title: 'Comet',
        lines: [
          `shooting star · ${Math.ceil(comet.hp)} / ${comet.maxHp} hp`,
          `drops ${COMET_RESOURCES.map((kind) => RESOURCES[kind].label.toLowerCase()).join(', ')}`,
          'sheds chunks as you mine it',
        ],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: COMET_ACCENT,
      };
    }
    if (pick.kind === 'pickup') {
      const { pickup } = pick;
      const item = defaultItemCatalog().require(pickup.kind);
      return {
        title: pickup.count > 1 ? `${item.name} × ${pickup.count}` : item.name,
        lines: [item.description, `worth ${item.value * pickup.count}${pickup.life === Infinity ? ' · cache' : ''}`],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: item.visual.colour,
      };
    }
    if (pick.kind === 'hazard') {
      const { hazard } = pick;
      return {
        title: hazard.label,
        lines: [`gas cloud · ${hazard.damagePerSecond} damage/s inside`, `radius ${hazard.radius.toFixed(0)} · shields soak it first`],
        x: pointerPx.x,
        y: pointerPx.y,
        accent: hazard.colour,
      };
    }
    const rock = this.sim.rocks.get(pick.rockId);
    if (!rock) return null;
    const info = ROCK_KINDS[rock.kind];
    const size = rock.kind === 'giant' ? 'giant' : rock.radius >= 4 ? 'large' : rock.radius >= 2.5 ? 'medium' : 'small';
    return {
      title: `${info.label} rock`,
      lines: [`${size} · ${Math.ceil(rock.hp)} / ${rock.maxHp} hp`, `drops ${rockDropItems(rock.kind).map((kind) => RESOURCES[kind].label.toLowerCase()).join(', ')}`],
      x: pointerPx.x,
      y: pointerPx.y,
      accent: ROCK_BAR_COLOURS[rock.kind],
    };
  }

  private setPixelation(level: number, scope: PixelScope): void {
    this.scene.setPixelation(level, scope);
    try {
      window.localStorage.setItem(PIXEL_SETTINGS_KEY, JSON.stringify({ level: this.scene.pixelLevel, scope }));
    } catch {
      // Storage may be unavailable; the setting just will not persist.
    }
  }

  private loadPixelSettings(): void {
    try {
      const raw = window.localStorage.getItem(PIXEL_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { level?: unknown; scope?: unknown };
      const level = typeof parsed.level === 'number' ? parsed.level : this.scene.pixelLevel;
      const scope = parsed.scope === '3d' || parsed.scope === 'all' ? parsed.scope : this.scene.pixelScope;
      this.scene.setPixelation(level, scope);
    } catch {
      // Ignore malformed or unavailable storage.
    }
  }
}

function chipColour(rock: Rock): string {
  return rock.kind === 'ice' ? '#bfe0f0' : rock.kind === 'crystal' ? '#c9a6ff' : ROCK_CHIP_COLOUR;
}
