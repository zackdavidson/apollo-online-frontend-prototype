import { createDefaultCatalog, type Catalog } from '../catalog/catalog';
import { Animations, EntityType, EXAMINE_OPTION, Graphics, HUD_INTERFACE_IDS, INTERFACE_IDS, MAP_BUTTONS, packRgb, Varps, WEAPON_GROUP_BY_INDEX } from '../client/definitions';
import type { ClientMessage, EntityUpdate, ServerMessage } from '../client/messages';
import { COMBAT_TUNING } from '../game/combat';
import { TurretAi, type ShipController } from '../game/controllers';
import type { GameEvent } from '../game/events';
import { IDLE_INPUT, type FlightInput } from '../game/flightController';
import { defaultItemCatalog } from '../game/items';
import { hullDisplayName, shipRadiusFor, surfaceFor, weaponMountsFor } from '../game/loadout';
import { RESOURCE_KINDS, RESOURCES, type ResourceKind } from '../game/loot';
import type { ResolvedMap } from '../game/map';
import { formatMapCoords } from '../game/mapCoords';
import { ROCK_KINDS, rockDropItems, type Rock } from '../game/rocks';
import { WorldSim } from '../game/simulation';
import { freshTalents } from '../game/talents';
import { WEAPON_GROUPS } from '../game/weapons';
import type { ShipEntity, ShipId, Stance } from '../game/world';
import { parseInterfaceCommand, type DialogueLine } from '../hud/interfaces';
import type { ShipState } from '../state/shipState';
import { chipColour, COMET_ACCENT, FRIENDLY_ACCENT, NPC_ACCENT } from './colours';
import { WARP_RANGE } from './presenter';

/**
 * The offline sandbox: the local simulation dressed as a server. It takes
 * the same client packets the real server will and answers with the same
 * server packets, so the flight code cannot tell the two apart and the
 * hangar's "Fly this ship" keeps working without a server. It is also a
 * worked example of how each simulation event maps onto the protocol.
 */
export interface SandboxNpc {
  readonly name: string;
  readonly build: ShipState;
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
  readonly stance?: Stance;
  readonly provokable?: boolean;
  readonly invulnerable?: boolean;
  readonly dialogue?: { readonly range?: number; readonly lines: readonly DialogueLine[] };
}

export interface SandboxOptions {
  readonly map: ResolvedMap;
  readonly player: { readonly name: string; readonly build: ShipState };
  readonly npcs?: readonly SandboxNpc[];
  readonly catalog?: Catalog;
}

interface ShipMeta {
  readonly index: number;
  readonly build: ShipState;
  readonly accent: string;
  readonly talkRange: number | null;
  readonly dialogue: SandboxNpc['dialogue'] | undefined;
}

const PLAYER_ID: ShipId = 'player';
const PLAYER_INDEX = 1;
const COMET_INDEX = 100;
const DEFAULT_INTERACT_RANGE = 30;
/** How far beyond the hull "Take" reaches for a dropped stack. */
const TAKE_RANGE = 10;
/** Clicking this close to the existing flag clears it. */
const FLAG_CLEAR_RADIUS = 8;
const HOMING_ACQUIRE_RANGE = 90;
const TICK = 1 / 60;

type MineTarget = { readonly kind: 'rock'; readonly rockId: string } | { readonly kind: 'comet' };

export class SandboxServer {
  readonly sim: WorldSim;
  private readonly catalog: Catalog;
  private readonly meta = new Map<ShipId, ShipMeta>();
  private readonly idByIndex = new Map<number, ShipId>();
  private readonly status = new Map<number, { alive: boolean; hostile: boolean; held: boolean }>();
  private cometShown = false;
  private readonly projectiles = new Map<number, number>();
  private readonly pickups = new Set<number>();
  private readonly varps = new Map<number, number>();
  private lastCargo = '';
  private input: FlightInput = IDLE_INPUT;
  private mining: MineTarget | null = null;
  private dialogue: { readonly lines: readonly DialogueLine[]; index: number } | null = null;
  private flag: { readonly x: number; readonly z: number } | null = null;
  private chatQueue: string[] = [];
  private npcCounter = 1;

  constructor(
    options: SandboxOptions,
    private readonly deliver: (message: ServerMessage) => void,
  ) {
    this.catalog = options.catalog ?? createDefaultCatalog();
    this.sim = new WorldSim(options.map);
    const { build, name } = options.player;
    const hull = this.catalog.getHull(build.hullId);
    this.sim.addShip({
      id: PLAYER_ID,
      name,
      hullName: hullDisplayName(hull),
      team: 'players',
      radius: shipRadiusFor(surfaceFor(build, this.catalog)),
      weaponMounts: weaponMountsFor(build, this.catalog),
      maxShield: COMBAT_TUNING.playerShield,
      maxHull: COMBAT_TUNING.playerHull,
      spawn: options.map.spawn,
      respawnDelay: COMBAT_TUNING.playerRespawnDelay,
      collectsLoot: true,
    });
    this.meta.set(PLAYER_ID, { index: PLAYER_INDEX, build, accent: build.colours.trim, talkRange: null, dialogue: undefined });
    this.idByIndex.set(PLAYER_INDEX, PLAYER_ID);
    for (const npc of options.npcs ?? []) this.spawnNpc(npc);
  }

  spawnNpc(npc: SandboxNpc): void {
    const id: ShipId = `npc-${this.npcCounter++}`;
    const index = this.npcCounter;
    const hull = this.catalog.getHull(npc.build.hullId);
    this.sim.addShip({
      id,
      name: npc.name,
      hullName: hullDisplayName(hull),
      team: npc.team ?? 'raiders',
      radius: shipRadiusFor(surfaceFor(npc.build, this.catalog)),
      weaponMounts: weaponMountsFor(npc.build, this.catalog),
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
    this.meta.set(id, { index, build: npc.build, accent: npc.accent ?? NPC_ACCENT, talkRange: npc.dialogue ? (npc.dialogue.range ?? DEFAULT_INTERACT_RANGE) : null, dialogue: npc.dialogue });
    this.idByIndex.set(index, id);
  }

  // ---- session -----------------------------------------------------------------------

  /** What the real server sends once the handshake is accepted. */
  login(): void {
    this.deliver({ type: 'login-response', status: 'ok', message: '', playerIndex: PLAYER_INDEX, serverTime: this.sim.time, tick: TICK });
    for (const standing of freshTalents()) this.deliver({ type: 'update-stat', stat: standing.id, level: standing.level, base: standing.base });
    this.deliver({ type: 'set-map-flag', flag: null });
    this.deliver({ type: 'message-game', kind: 'game', text: `Welcome to ${this.sim.map.name}. Press Enter to chat, Space to talk to ships, /help for controls.` });
  }

  /** The client's flight input; the server applies it every tick. */
  setInput(input: FlightInput): void {
    this.input = input;
  }

  receive(message: ClientMessage): void {
    const player = this.player;
    switch (message.type) {
      case 'move-flight':
        this.setInput({ thrust: message.thrust, strafe: message.strafe, boost: message.boost, fire: message.fire, aim: message.aim });
        return;
      case 'move-minimap-click':
        this.setFlag(message.x, message.z);
        return;
      case 'op-npc':
        this.npcOption(message.index, message.option);
        return;
      case 'op-player':
        if (message.option === EXAMINE_OPTION) this.message(this.examineShip(this.idByIndex.get(message.index)));
        return;
      case 'op-loc':
        this.locOption(message.locId, message.option);
        return;
      case 'op-obj':
        if (message.option === EXAMINE_OPTION) {
          const pickup = this.sim.loot.get(message.index);
          if (pickup) {
            const item = defaultItemCatalog().require(pickup.kind);
            this.message(`${item.description} Worth ${item.value * pickup.count}.`);
          }
        } else if (message.option === 1) {
          if (!this.sim.loot.get(message.index)) return;
          if (!this.sim.takePickup(PLAYER_ID, message.index, player.spec.radius + TAKE_RANGE)) this.message("You're too far away to take that.");
        }
        return;
      case 'op-held': {
        const item = defaultItemCatalog().get(message.item);
        if (message.option === EXAMINE_OPTION) this.message(item ? (item.stackable ? `${item.description} Worth ${item.value} each.` : item.description || 'Standard issue.') : 'Nothing to see.');
        else if (message.option === 1 && (RESOURCE_KINDS as readonly string[]).includes(message.item)) {
          const kind = message.item as ResourceKind;
          if (!this.sim.dropCargo(PLAYER_ID, kind, player.cargo[kind])) this.message("You can't drop that right now.");
        }
        return;
      }
      case 'if-button':
        this.button(message.interfaceId, message.button);
        return;
      case 'resume-pause-button':
        if (message.interfaceId === HUD_INTERFACE_IDS.dialogue) this.advanceDialogue();
        return;
      case 'close-modal':
        if (message.interfaceId === HUD_INTERFACE_IDS.dialogue) this.endDialogue(false);
        return;
      case 'message-public':
        this.chatQueue.push(message.text);
        return;
      case 'client-cheat':
        this.cheat(message.text);
        return;
      case 'handshake':
      case 'logout':
      case 'idle':
        return;
    }
  }

  // ---- stepping -------------------------------------------------------------------------

  step(dt: number): void {
    this.sim.setInput(PLAYER_ID, this.applyAutoMine(this.input));
    const events = this.sim.step(dt);
    const players: EntityUpdate[] = [];
    const npcs: EntityUpdate[] = [];
    const teleported = new Set<ShipId>();
    const extras = new Map<number, EntityUpdate[]>();
    const extra = (index: number, update: Omit<EntityUpdate, 'index'>): void => {
      const list = extras.get(index) ?? [];
      list.push({ index, ...update });
      extras.set(index, list);
    };
    this.translate(events, teleported, extra);

    // Entity updating: appearance once, status when it changes, movement every tick.
    for (const ship of this.sim.allShips()) {
      const meta = this.meta.get(ship.spec.id);
      if (!meta) continue;
      const update = this.shipUpdate(ship, meta, teleported.has(ship.spec.id));
      const list = ship.spec.id === PLAYER_ID ? players : npcs;
      list.push(update);
      for (const more of extras.get(meta.index) ?? []) list.push(more);
      extras.delete(meta.index);
    }
    for (const [index, list] of extras) for (const update of list) (this.idByIndex.get(index) === PLAYER_ID ? players : npcs).push(update);
    for (const [index, id] of this.idByIndex) {
      if (!this.sim.getShip(id)) {
        (id === PLAYER_ID ? players : npcs).push({ index, remove: true });
        this.idByIndex.delete(index);
        this.meta.delete(id);
        this.status.delete(index);
      }
    }
    npcs.push(...this.cometUpdates());
    if (players.length) this.deliver({ type: 'player-info', t: this.sim.time, entities: players });
    if (npcs.length) this.deliver({ type: 'npc-info', t: this.sim.time, entities: npcs });

    this.syncProjectiles();
    this.syncPickups();
    this.syncVarps();
    this.syncInventory();
    this.tendMining();
  }

  private get player(): ShipEntity {
    return this.sim.getShip(PLAYER_ID)!;
  }

  private shipUpdate(ship: ShipEntity, meta: ShipMeta, teleport: boolean): EntityUpdate {
    const update: { -readonly [K in keyof EntityUpdate]: EntityUpdate[K] } = { index: meta.index };
    if (!this.status.has(meta.index)) {
      update.appearance = {
        entityType: EntityType.SHIP,
        name: ship.spec.name,
        hullName: ship.spec.hullName,
        team: ship.spec.team,
        radius: ship.spec.radius,
        build: meta.build,
        accent: meta.accent,
        invulnerable: ship.spec.invulnerable ?? false,
        provokable: ship.spec.provokable !== false,
        talkRange: meta.talkRange,
        maxShield: ship.vitals.maxShield,
        maxHull: ship.vitals.maxHull,
      };
    }
    const status = { alive: ship.alive, hostile: ship.stance === 'hostile', held: ship.held };
    const last = this.status.get(meta.index);
    if (!last || last.alive !== status.alive || last.hostile !== status.hostile || last.held !== status.held) {
      update.status = status;
      this.status.set(meta.index, status);
    }
    const s = ship.state;
    update.movement = { teleport, x: s.x, z: s.z, vx: s.vx, vz: s.vz, heading: s.heading, throttle: s.throttle };
    if (ship.warp) {
      const spooling = this.sim.time < ship.warp.blankAt;
      update.animation = spooling ? Animations.WARP_SPOOL : Animations.NONE;
    }
    if (meta.index === PLAYER_INDEX && this.chatQueue.length) update.chat = this.chatQueue.shift();
    return update;
  }

  private cometUpdates(): EntityUpdate[] {
    const comet = this.sim.comet;
    if (!comet.alive) {
      if (!this.cometShown) return [];
      this.cometShown = false;
      return [{ index: COMET_INDEX, remove: true }];
    }
    const update: { -readonly [K in keyof EntityUpdate]: EntityUpdate[K] } = { index: COMET_INDEX, movement: { teleport: !this.cometShown, x: comet.x, z: comet.z, vx: comet.vx, vz: comet.vz, heading: 0, throttle: 0 } };
    if (!this.cometShown) {
      this.cometShown = true;
      update.appearance = { entityType: EntityType.COMET, name: 'Comet', hullName: '', team: 'comet', radius: comet.radius, build: { hullId: '', colours: { main: '', trim: '' }, material: '', fitted: {} }, accent: COMET_ACCENT, invulnerable: false, provokable: false, talkRange: null, maxShield: 0, maxHull: comet.maxHp };
      update.status = { alive: true, hostile: true, held: false };
    }
    return [update];
  }

  /** Simulation events to packets: masks on entities, graphics at places, loc and obj changes, messages. */
  private translate(events: readonly GameEvent[], teleported: Set<ShipId>, extra: (index: number, update: Omit<EntityUpdate, 'index'>) => void): void {
    const anim = (graphic: number, x: number, z: number, scale: number, colour: string | null = null): void => this.deliver({ type: 'map-anim', graphic, x, z, scale, rgb: colour ? packRgb(colour) : 0 });
    const indexOf = (id: ShipId): number | undefined => this.meta.get(id)?.index;
    const hitOn = (id: ShipId, amount: number, kind: 'normal' | 'glancing' | 'critical', absorbed: boolean, x: number, z: number): void => {
      const ship = this.sim.getShip(id);
      const index = indexOf(id);
      if (!ship || index === undefined) return;
      extra(index, { hit: { amount, kind, absorbed, x, z, shield: ship.vitals.shield, hull: ship.vitals.hull } });
    };
    const absorbedAfter = (from: number, id: ShipId): boolean => {
      for (let i = from + 1; i < events.length; i++) {
        const next = events[i]!;
        if (next.type === 'ship-damaged' && next.shipId === id) return next.hullDamage <= 0;
      }
      return false;
    };
    events.forEach((event, i) => {
      switch (event.type) {
        case 'shot-fired':
          anim(Graphics.MUZZLE_FLASH, event.x, event.z, event.weapon.muzzleFlash);
          return;
        case 'projectile-expired':
          if (event.weapon.kind === 'flak') anim(Graphics.FLAK_POP, event.x, event.z, 1, event.weapon.colour);
          return;
        case 'beam-fired':
          for (const shot of event.shots) {
            this.deliver({ type: 'map-projanim', id: this.nextProjectileId++, item: event.weapon.id, x0: shot.x0, z0: shot.z0, y: shot.y ?? 0.4, x1: shot.x1, z1: shot.z1, target: null, delay: 0, duration: shot.duration });
            anim(Graphics.MUZZLE_FLASH, shot.x0, shot.z0, event.weapon.muzzleFlash);
            anim(Graphics.BEAM_IMPACT, shot.x1, shot.z1, 1, event.weapon.colour);
            if (event.weapon.beamStyle === 'siege') {
              anim(Graphics.SIEGE_SHOCK, shot.x0, shot.z0, 4, event.weapon.colour);
              anim(Graphics.SIEGE_SHOCK, shot.x1, shot.z1, 6, event.weapon.colour);
            }
          }
          return;
        case 'hit':
          if (event.target.kind === 'ship') hitOn(event.target.shipId, event.amount, event.kind, event.absorbed, event.x, event.z);
          else if (event.target.kind === 'comet') extra(COMET_INDEX, { hit: { amount: event.amount, kind: event.kind, absorbed: false, x: event.x, z: event.z, shield: 0, hull: this.sim.comet.hp } });
          else this.deliver({ type: 'hit-splat', amount: event.amount, kind: event.kind, x: event.x, z: event.z });
          return;
        case 'ship-collided':
          hitOn(event.shipId, event.damage, 'normal', absorbedAfter(i, event.shipId), event.x, event.z);
          return;
        case 'hazard-damage':
          hitOn(event.shipId, event.amount, 'normal', absorbedAfter(i, event.shipId), event.x, event.z);
          anim(Graphics.GAS_PUFF, event.x, event.z, 1, event.hazard.colour);
          return;
        case 'ship-damaged':
          return;
        case 'ship-destroyed': {
          const index = indexOf(event.shipId);
          const ship = this.sim.getShip(event.shipId);
          if (index !== undefined) extra(index, { spotAnim: { graphic: Graphics.EXPLOSION, scale: ship?.spec.radius ?? 3, rgb: 0 } });
          if (event.shipId === PLAYER_ID) this.deliver({ type: 'message-game', kind: 'both', text: 'Ship destroyed. Respawning...' });
          else this.deliver({ type: 'message-game', kind: 'both', text: `${ship?.spec.name ?? 'Enemy'} destroyed` });
          return;
        }
        case 'ship-respawned':
          teleported.add(event.shipId);
          anim(Graphics.RESPAWN, event.x, event.z, this.sim.getShip(event.shipId)?.spec.radius ?? 3);
          return;
        case 'ship-removed':
          return;
        case 'ship-stance-changed': {
          const ship = this.sim.getShip(event.shipId);
          if (ship && event.stance === 'hostile') {
            anim(Graphics.HOSTILE, ship.state.x, ship.state.z, ship.spec.radius);
            this.deliver({ type: 'message-game', kind: 'both', text: event.reason === 'provoked' ? `${ship.spec.name} turns hostile!` : `${ship.spec.name} opens fire!` });
          }
          return;
        }
        case 'rock-damaged':
          this.deliver({ type: 'loc-health', id: event.rock.id, hp: event.rock.hp });
          anim(Graphics.ROCK_CHIPS, event.x, event.z, 1, chipColour(event.rock));
          return;
        case 'rock-destroyed':
          this.deliver({ type: 'loc-del', id: event.rock.id });
          anim(Graphics.ROCK_BREAK, event.rock.x, event.rock.z, event.rock.radius, chipColour(event.rock));
          return;
        case 'rock-respawned':
          this.deliver({ type: 'loc-add', id: event.rock.id });
          anim(Graphics.ROCK_RESPAWN, event.rock.x, event.rock.z, event.rock.radius);
          return;
        case 'hazard-entered':
          if (event.shipId === PLAYER_ID) {
            this.deliver({ type: 'message-game', kind: 'banner', text: `Entering ${event.hazard.label}` });
            this.message(`Entering ${event.hazard.label}: ${event.hazard.damagePerSecond} damage a second.`);
          }
          return;
        case 'hazard-left':
          return;
        case 'comet-damaged':
          anim(Graphics.COMET_SPARK, event.x, event.z, 1);
          return;
        case 'comet-chunk':
          anim(Graphics.COMET_CHUNK, event.x, event.z, 1);
          return;
        case 'comet-destroyed':
          anim(Graphics.COMET_BURST, event.x, event.z, event.radius);
          this.deliver({ type: 'message-game', kind: 'banner', text: 'Comet mined out' });
          return;
        case 'comet-entered':
          this.deliver({ type: 'message-game', kind: 'banner', text: 'A comet has entered the sector' });
          return;
        case 'comet-left':
          this.deliver({ type: 'message-game', kind: 'banner', text: 'The comet has left the sector' });
          return;
        case 'pickup-collected':
          if (event.shipId === PLAYER_ID) {
            anim(Graphics.PICKUP, this.player.state.x, this.player.state.z, 1, RESOURCES[event.kind].colour);
            if (event.kind === 'crystal') this.deliver({ type: 'message-game', kind: 'banner', text: `+${event.count} crystal` });
          }
          return;
        case 'pickup-dropped':
          if (event.shipId === PLAYER_ID) this.message(`Dropped ${RESOURCES[event.kind].label} × ${event.count}.`);
          return;
        case 'warp-started': {
          const index = indexOf(event.shipId);
          const ship = this.sim.getShip(event.shipId);
          if (index !== undefined && ship?.warp) extra(index, { warp: ship.warp });
          anim(Graphics.WARP_SPOOL, event.x, event.z, ship?.spec.radius ?? 3);
          return;
        }
        case 'warp-blanked':
          teleported.add(event.shipId);
          return;
        case 'warp-arrived':
          anim(Graphics.WARP_ARRIVE, event.x, event.z, this.sim.getShip(event.shipId)?.spec.radius ?? 3);
          if (event.shipId === PLAYER_ID) {
            this.deliver({ type: 'message-game', kind: 'banner', text: `Arrived at ${formatMapCoords(event.x, event.z, this.sim.halfExtent)}` });
            if (this.flag && Math.hypot(this.flag.x - event.x, this.flag.z - event.z) < 6) {
              this.flag = null;
              this.deliver({ type: 'set-map-flag', flag: null });
            }
          }
          return;
        case 'warp-done':
          return;
        case 'beacon-reached':
          anim(Graphics.BEACON_PULSE, event.beacon.x, event.beacon.z, event.beacon.radius, event.beacon.colour);
          if (event.shipId === PLAYER_ID) this.deliver({ type: 'message-game', kind: 'both', text: `Reached ${event.beacon.label}` });
          return;
      }
    });
  }

  private nextProjectileId = 1;

  /** New shots become MAP_PROJANIM once; shots gone before their time get PROJ_DEL. */
  private syncProjectiles(): void {
    const seen = new Set<number>();
    for (const ship of this.sim.allShips()) {
      for (const p of ship.pool.projectiles) {
        seen.add(p.id);
        if (this.projectiles.has(p.id)) continue;
        this.projectiles.set(p.id, this.sim.time + p.life);
        this.deliver({ type: 'map-projanim', id: p.id, item: p.weapon.id, x0: p.x, z0: p.z, y: p.y, x1: p.x + p.vx * p.life, z1: p.z + p.vz * p.life, target: p.weapon.homing ? this.homingTarget(ship) : null, delay: 0, duration: p.life });
      }
    }
    for (const [id, endsAt] of this.projectiles) {
      if (seen.has(id)) continue;
      this.projectiles.delete(id);
      if (endsAt - this.sim.time > 0.05) this.deliver({ type: 'proj-del', id });
    }
  }

  /** The entity a homing shot from this ship would chase: the nearest hostile other-team ship, or the comet. */
  private homingTarget(ship: ShipEntity): number | null {
    let best: number | null = null;
    let bestDistance = HOMING_ACQUIRE_RANGE;
    for (const other of this.sim.allShips()) {
      if (other === ship || !other.alive || other.spec.team === ship.spec.team || other.stance === 'friendly') continue;
      const distance = Math.hypot(other.state.x - ship.state.x, other.state.z - ship.state.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = this.meta.get(other.spec.id)?.index ?? null;
      }
    }
    if (this.sim.comet.alive && Math.hypot(this.sim.comet.x - ship.state.x, this.sim.comet.z - ship.state.z) < bestDistance) best = COMET_INDEX;
    return best;
  }

  private syncPickups(): void {
    const seen = new Set<number>();
    for (const pickup of this.sim.loot.pickups) {
      seen.add(pickup.id);
      if (this.pickups.has(pickup.id)) continue;
      this.pickups.add(pickup.id);
      this.deliver({ type: 'obj-add', index: pickup.id, item: pickup.kind, count: pickup.count, x: pickup.x, z: pickup.z, permanent: pickup.life === Infinity });
    }
    for (const id of this.pickups) {
      if (seen.has(id)) continue;
      this.pickups.delete(id);
      this.deliver({ type: 'obj-del', index: id });
    }
  }

  private syncVarps(): void {
    const player = this.player;
    const set = (id: number, value: number): void => {
      if (this.varps.get(id) === value) return;
      this.varps.set(id, value);
      this.deliver({ type: 'varp', id, value });
    };
    set(Varps.KILLS, player.kills);
    set(Varps.DEATHS, player.deaths);
    set(Varps.ROCKS_BROKEN, this.sim.rocks.brokenCount);
    set(Varps.ACTIVE_WEAPON_GROUP, Math.max(0, WEAPON_GROUP_BY_INDEX.indexOf(player.activeGroup)));
    for (const group of this.sim.weaponStatus(PLAYER_ID)) {
      const fill = Math.round(group.fill * 1000);
      if (group.id === 'guns') set(Varps.GUNS_READY, fill);
      else if (group.id === 'missiles') set(Varps.MISSILES_READY, fill);
      else {
        set(Varps.BEAM_CHARGE, group.phase === 'charging' ? Math.round(player.beam.charge * 1000) : fill);
        set(Varps.BEAM_PHASE, group.phase === 'ready' ? 0 : group.phase === 'charging' ? 1 : 2);
      }
    }
    const inside = player.alive ? this.sim.hazards.insideFor(PLAYER_ID)[0] : undefined;
    set(Varps.INSIDE_HAZARD, inside ? this.sim.hazards.hazards.indexOf(inside) : -1);
  }

  private syncInventory(): void {
    const cargo = this.player.cargo;
    const key = JSON.stringify(cargo);
    if (key === this.lastCargo) return;
    this.lastCargo = key;
    this.deliver({ type: 'update-inv-full', items: RESOURCE_KINDS.filter((kind) => cargo[kind] > 0).map((kind) => ({ item: kind, count: cargo[kind] })) });
  }

  // ---- options -----------------------------------------------------------------------

  private npcOption(index: number, option: number): void {
    if (index === COMET_INDEX) {
      if (option === EXAMINE_OPTION) this.message(this.sim.comet.alive ? `A shooting star crossing the sector; it sheds chunks as it is mined. ${Math.ceil(this.sim.comet.hp)} / ${this.sim.comet.maxHp} hp.` : 'It is gone.');
      else if (option === 1) this.startMining({ kind: 'comet' });
      return;
    }
    const id = this.idByIndex.get(index);
    const ship = id ? this.sim.getShip(id) : undefined;
    const meta = id ? this.meta.get(id) : undefined;
    if (!ship || !meta) return;
    if (option === EXAMINE_OPTION) {
      this.message(this.examineShip(id));
      return;
    }
    if (option !== 1 || !meta.dialogue) return;
    const player = this.player;
    const distance = Math.hypot(ship.state.x - player.state.x, ship.state.z - player.state.z);
    if (!ship.alive || !player.alive || distance > (meta.talkRange ?? DEFAULT_INTERACT_RANGE)) {
      this.message("You're too far away to talk.");
      return;
    }
    this.dialogue = { lines: meta.dialogue.lines, index: 0 };
    this.sim.setHeld(PLAYER_ID, true);
    this.showDialogueLine();
  }

  private examineShip(id: ShipId | undefined): string {
    const ship = id ? this.sim.getShip(id) : undefined;
    if (!ship) return 'Nothing to see.';
    const mood = id === PLAYER_ID ? 'That is you.' : ship.spec.invulnerable ? 'Nothing you have can scratch it.' : ship.stance === 'friendly' ? 'Friendly, for now.' : 'Hostile.';
    return `${ship.spec.hullName}. ${mood}`;
  }

  private locOption(locId: string, option: number): void {
    const rock = this.sim.rocks.get(locId);
    if (rock) {
      if (option === 1) this.startMining({ kind: 'rock', rockId: rock.id });
      else if (option === EXAMINE_OPTION) this.message(this.examineRock(rock));
      return;
    }
    if (option !== EXAMINE_OPTION) return;
    const beacon = this.sim.beacons.beacons.find((candidate) => candidate.id === locId);
    if (beacon) {
      this.message(`${beacon.description || 'A beacon.'} Fly through it to activate.`);
      return;
    }
    const hazard = this.sim.hazards.hazards.find((candidate) => candidate.id === locId);
    if (hazard) this.message(`A gas cloud ${hazard.radius.toFixed(0)} units across. ${hazard.damagePerSecond} damage a second to anything inside.`);
  }

  private examineRock(rock: Rock): string {
    const items = defaultItemCatalog();
    const yields = rockDropItems(rock.kind).map((kind) => items.require(kind).name.toLowerCase()).join(' and ');
    return `${ROCK_KINDS[rock.kind].description} Yields ${yields}. ${Math.ceil(rock.hp)} / ${rock.maxHp} hp.`;
  }

  private button(interfaceId: number, button: number): void {
    if (interfaceId === HUD_INTERFACE_IDS.weapons) {
      const group = WEAPON_GROUPS[button - 1];
      if (group) this.sim.selectWeaponGroup(PLAYER_ID, group.id);
      return;
    }
    if (interfaceId === INTERFACE_IDS.map && button === MAP_BUTTONS.warp) this.warp();
  }

  private setFlag(x: number, z: number): void {
    if (this.flag && Math.hypot(this.flag.x - x, this.flag.z - z) <= FLAG_CLEAR_RADIUS) {
      this.flag = null;
      this.deliver({ type: 'set-map-flag', flag: null });
      this.message('Waypoint cleared.');
      return;
    }
    this.flag = { x, z };
    this.deliver({ type: 'set-map-flag', flag: this.flag });
    const player = this.player;
    const distance = Math.hypot(x - player.state.x, z - player.state.z);
    this.message(`Waypoint set at ${formatMapCoords(x, z, this.sim.halfExtent)} · ${distance.toFixed(0)} units away${distance > WARP_RANGE ? ` (warp range ${WARP_RANGE})` : ''}.`);
  }

  private warp(): void {
    const player = this.player;
    if (!this.flag) {
      this.message('No waypoint. Open the map (M) and click where you want to go.');
      return;
    }
    const distance = Math.hypot(this.flag.x - player.state.x, this.flag.z - player.state.z);
    if (distance > WARP_RANGE) {
      this.message(`Waypoint is ${distance.toFixed(0)} units away; the warp drive reaches ${WARP_RANGE}.`);
      return;
    }
    if (!this.sim.requestWarp(PLAYER_ID, this.flag.x, this.flag.z, WARP_RANGE)) this.message('Warp drive is busy.');
  }

  private cheat(text: string): void {
    const [command = '', ...args] = text.split(/\s+/);
    if (command.toLowerCase() !== 'ui') {
      this.message(`Unknown command "/${text}". Try /help or /ui.`);
      return;
    }
    const parsed = parseInterfaceCommand(args);
    if (typeof parsed === 'string') {
      this.message(parsed === 'list' ? 'Usage: /ui list is answered by the client.' : parsed);
      return;
    }
    switch (parsed.type) {
      case 'interface-open':
        this.deliver({ type: 'if-opensub', id: parsed.id, props: parsed.props ?? {} });
        return;
      case 'interface-close':
        this.deliver({ type: 'if-closesub', id: parsed.id });
        return;
      case 'interface-set':
        this.deliver({ type: 'if-setprops', id: parsed.id, props: parsed.props });
        return;
      case 'interface-close-slot':
        this.message('Close windows by id: /ui close <id>.');
        return;
    }
  }

  // ---- dialogue ------------------------------------------------------------------------

  private showDialogueLine(): void {
    const line = this.dialogue?.lines[this.dialogue.index];
    if (!line) {
      this.endDialogue(true);
      return;
    }
    this.deliver({ type: 'if-opensub', id: HUD_INTERFACE_IDS.dialogue, props: { speaker: line.speaker, text: line.text, portrait: line.portrait ?? '' } });
  }

  private advanceDialogue(): void {
    if (!this.dialogue) return;
    this.dialogue.index += 1;
    this.showDialogueLine();
  }

  private endDialogue(tellClient: boolean): void {
    if (!this.dialogue) return;
    this.dialogue = null;
    this.sim.setHeld(PLAYER_ID, false);
    if (tellClient) this.deliver({ type: 'if-closesub', id: HUD_INTERFACE_IDS.dialogue });
  }

  // ---- mining --------------------------------------------------------------------------

  private startMining(target: MineTarget): void {
    const player = this.player;
    if (player.beamMounts.length === 0) {
      this.message('You have nothing to mine with. Fit a mining laser or drill.');
      return;
    }
    this.sim.selectWeaponGroup(PLAYER_ID, 'beam');
    this.mining = target;
    this.message(target.kind === 'rock' ? 'You begin mining the rock.' : 'You begin mining the comet.');
  }

  /** While mining, the server aims and holds the trigger; any manual input or a lost target stops it. */
  private applyAutoMine(input: FlightInput): FlightInput {
    const target = this.mining;
    if (!target) return input;
    const player = this.player;
    if (!player.alive || player.held || input.thrust !== 0 || input.strafe !== 0 || input.fire) {
      this.mining = null;
      return input;
    }
    const point = target.kind === 'rock' ? this.sim.rocks.get(target.rockId) : this.sim.comet.alive ? this.sim.comet : null;
    if (!point || (target.kind === 'rock' && (point as Rock).hp <= 0)) {
      this.mining = null;
      return input;
    }
    const range = Math.max(...player.beamMounts.map((mount) => mount.weapon.range ?? 0));
    if (Math.hypot(point.x - player.state.x, point.z - player.state.z) > range) {
      this.mining = null;
      this.message(`You need to be within ${range.toFixed(0)} units to mine that.`);
      return input;
    }
    return { ...input, aim: [point.x, point.z], fire: true };
  }

  private tendMining(): void {
    // Nothing between steps for now; applyAutoMine runs at the start of each step.
  }

  private message(text: string): void {
    this.deliver({ type: 'message-game', kind: 'game', text });
  }
}

export { FRIENDLY_ACCENT };
