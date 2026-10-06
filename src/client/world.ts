import type { Catalog } from '../catalog/catalog';
import type { CometState } from '../game/comet';
import type { Vitals } from '../game/combat';
import { INITIAL_FLIGHT_STATE, type FlightState } from '../game/flightController';
import { weaponMountsFor } from '../game/loadout';
import { emptyInventory, RESOURCE_KINDS, type Inventory, type Pickup, type ResourceKind } from '../game/loot';
import type { ResolvedMap } from '../game/map';
import type { WeaponMount } from '../game/projectiles';
import { hashToUnit, RockField } from '../game/rocks';
import type { TalentStanding } from '../game/talents';
import type { WarpPlan } from '../game/warp';
import { weaponProfileFor, type WeaponProfile } from '../game/weapons';
import { EntityType, Varps, WEAPON_GROUP_BY_INDEX } from './definitions';
import { PoseBuffer } from './interpolation';
import { applyMessage } from './mechanics';
import type { EntityAppearance, EntityUpdate, ServerMessage } from './messages';

/**
 * The client's copy of the world: everything the server has told it and
 * nothing it worked out for itself. Plain data the renderer and HUD read
 * each frame, written only by the mechanics' `apply` functions as packets
 * arrive and by `advance`, which moves time forward between packets
 * (interpolated poses, projectiles in flight).
 */
export interface ClientEntity {
  readonly index: number;
  readonly kind: 'player' | 'npc';
  /** Null until the first update carrying an appearance; nothing is drawn before then. */
  appearance: EntityAppearance | null;
  mounts: readonly WeaponMount[];
  beamMounts: readonly WeaponMount[];
  /** The pose to render this frame. */
  pose: FlightState;
  readonly poses: PoseBuffer;
  alive: boolean;
  hostile: boolean;
  held: boolean;
  vitals: Vitals;
  warp: WarpPlan | null;
  animation: number;
}

/** A projectile as RuneScape flies it: from a point to a point or an entity, over a duration. */
export interface ClientProjectile {
  readonly id: number;
  readonly weapon: WeaponProfile;
  readonly x0: number;
  readonly z0: number;
  readonly y: number;
  readonly x1: number;
  readonly z1: number;
  /** An entity to follow instead of flying to the end point. */
  readonly target: number | null;
  /** World time it starts moving (receipt plus the packet's delay). */
  readonly startAt: number;
  readonly duration: number;
}

/** Nominal life for a stack the server owns; it never fades on its own, the server removes it. */
const GROUND_ITEM_LIFE = 10;

export class ClientWorld {
  map: ResolvedMap | null = null;
  /** Rocks from the map; only their health moves over the wire. */
  rocks: RockField | null = null;
  playerIndex: number | null = null;
  readonly entities = new Map<number, ClientEntity>();
  readonly projectiles = new Map<number, ClientProjectile>();
  readonly groundItems = new Map<number, Pickup>();
  cargo: Inventory = emptyInventory();
  readonly stats = new Map<string, TalentStanding>();
  readonly varps = new Map<number, number>();
  /** The warp destination the server has confirmed. */
  mapFlag: { readonly x: number; readonly z: number } | null = null;
  /** Server time the world was last advanced to, in seconds. */
  time = 0;

  constructor(readonly catalog: Catalog) {}

  setMap(map: ResolvedMap): void {
    this.map = map;
    this.rocks = new RockField(map.rockSpecs);
  }

  get player(): ClientEntity | null {
    return this.playerIndex === null ? null : (this.entities.get(this.playerIndex) ?? null);
  }

  entity(kind: 'player' | 'npc', index: number): ClientEntity | undefined {
    const entity = this.entities.get(index);
    return entity?.kind === kind ? entity : undefined;
  }

  /** Every entity that can be drawn as a ship. */
  *ships(): IterableIterator<ClientEntity> {
    for (const entity of this.entities.values()) {
      if (entity.appearance && entity.appearance.entityType === EntityType.SHIP) yield entity;
    }
  }

  /** The comet NPC, as the comet renderer wants it, while one is in the sector. */
  get comet(): (CometState & { readonly index: number }) | null {
    for (const entity of this.entities.values()) {
      if (!entity.alive || entity.appearance?.entityType !== EntityType.COMET) continue;
      return { index: entity.index, x: entity.pose.x, z: entity.pose.z, vx: entity.pose.vx, vz: entity.pose.vz, hp: entity.vitals.hull, maxHp: entity.vitals.maxHull, radius: entity.appearance.radius, alive: true, respawnAt: Infinity, minedSinceChunk: 0 };
    }
    return null;
  }

  get talents(): TalentStanding[] {
    return [...this.stats.values()];
  }

  varp(id: number, fallback = 0): number {
    return this.varps.get(id) ?? fallback;
  }

  get activeWeaponGroup(): WeaponProfile['group'] {
    return WEAPON_GROUP_BY_INDEX[this.varp(Varps.ACTIVE_WEAPON_GROUP)] ?? 'guns';
  }

  /** 0..1 beam charge of the player's own ship, for the muzzle glows. */
  get beamCharge(): number {
    return this.varp(Varps.BEAM_CHARGE) / 1000;
  }

  /** Apply one entity's masks from a PLAYER_INFO or NPC_INFO at server time `t`. */
  updateEntity(kind: 'player' | 'npc', update: EntityUpdate, t: number): void {
    if (update.remove) {
      this.entities.delete(update.index);
      return;
    }
    let entity = this.entities.get(update.index);
    if (!entity) {
      entity = { index: update.index, kind, appearance: null, mounts: [], beamMounts: [], pose: INITIAL_FLIGHT_STATE, poses: new PoseBuffer(), alive: true, hostile: true, held: false, vitals: { shield: 0, maxShield: 0, hull: 0, maxHull: 0, lastHitAt: -Infinity }, warp: null, animation: 0 };
      this.entities.set(update.index, entity);
    }
    if (update.appearance) {
      const a = update.appearance;
      entity.appearance = a;
      entity.mounts = a.entityType === EntityType.SHIP && this.catalog.findHull(a.build.hullId) ? weaponMountsFor(a.build, this.catalog) : [];
      entity.beamMounts = entity.mounts.filter((mount) => mount.weapon.group === 'beam');
      const fresh = entity.vitals.maxHull === 0;
      entity.vitals = { ...entity.vitals, maxShield: a.maxShield, maxHull: a.maxHull, shield: fresh ? a.maxShield : entity.vitals.shield, hull: fresh ? a.maxHull : entity.vitals.hull };
    }
    if (update.movement) {
      const { teleport, ...pose } = update.movement;
      if (teleport) {
        entity.poses.reset();
        entity.pose = pose;
      }
      if (entity.poses.size === 0) entity.pose = pose;
      entity.poses.push(t, pose);
    } else if (update.face !== undefined) {
      const latest = entity.poses.latest ?? entity.pose;
      const turned = { ...latest, heading: update.face };
      if (entity.poses.size === 0) entity.pose = turned;
      entity.poses.push(t, turned);
    }
    if (update.status) {
      entity.alive = update.status.alive;
      entity.hostile = update.status.hostile;
      entity.held = update.status.held;
    }
    if (update.hit) entity.vitals = { ...entity.vitals, shield: update.hit.shield, hull: update.hit.hull, lastHitAt: t };
    if (update.warp) entity.warp = update.warp;
    if (update.animation !== undefined) entity.animation = update.animation;
  }

  addProjectile(p: { id: number; item: string; x0: number; z0: number; y: number; x1: number; z1: number; target: number | null; delay: number; duration: number }): ClientProjectile {
    const projectile: ClientProjectile = { id: p.id, weapon: weaponProfileFor(p.item), x0: p.x0, z0: p.z0, y: p.y, x1: p.x1, z1: p.z1, target: p.target, startAt: this.time + p.delay, duration: p.duration };
    this.projectiles.set(p.id, projectile);
    return projectile;
  }

  /** Where a projectile is now: between its start and its end point (or the entity it follows). */
  projectilePosition(projectile: ClientProjectile): { x: number; z: number; vx: number; vz: number; progress: number } {
    const target = projectile.target === null ? null : this.entities.get(projectile.target);
    const endX = target ? target.pose.x : projectile.x1;
    const endZ = target ? target.pose.z : projectile.z1;
    const progress = Math.max(0, Math.min(1, projectile.duration > 0 ? (this.time - projectile.startAt) / projectile.duration : 1));
    const vx = projectile.duration > 0 ? (endX - projectile.x0) / projectile.duration : 0;
    const vz = projectile.duration > 0 ? (endZ - projectile.z0) / projectile.duration : 0;
    return { x: projectile.x0 + (endX - projectile.x0) * progress, z: projectile.z0 + (endZ - projectile.z0) * progress, vx, vz, progress };
  }

  addGroundItem(index: number, item: string, count: number, x: number, z: number, permanent: boolean): Pickup | null {
    if (!(RESOURCE_KINDS as readonly string[]).includes(item)) return null;
    const pickup: Pickup = { id: index, kind: item as ResourceKind, count, x, z, life: permanent ? Infinity : GROUND_ITEM_LIFE, phase: hashToUnit(`obj:${index}`) * Math.PI * 2, armed: true };
    this.groundItems.set(index, pickup);
    return pickup;
  }

  setInventory(items: ReadonlyArray<{ readonly item: string; readonly count: number }>): void {
    const cargo = emptyInventory();
    for (const entry of items) {
      if ((RESOURCE_KINDS as readonly string[]).includes(entry.item)) cargo[entry.item as ResourceKind] = entry.count;
    }
    this.cargo = cargo;
  }

  /** Hand a decoded packet to whichever mechanic owns it. False when none does. */
  apply(message: ServerMessage): boolean {
    return applyMessage(this, message);
  }

  /** Move everything the client animates itself forward to `renderTime` (server clock, seconds). */
  advance(renderTime: number): void {
    this.time = renderTime;
    for (const entity of this.entities.values()) {
      const sampled = entity.poses.sample(renderTime);
      if (sampled) entity.pose = sampled;
      entity.poses.trim(renderTime);
      if (entity.warp && renderTime > entity.warp.doneAt) entity.warp = null;
    }
    for (const projectile of this.projectiles.values()) {
      if (renderTime > projectile.startAt + projectile.duration) this.projectiles.delete(projectile.id);
    }
  }

  /** Forget the sector: everything but the catalog. */
  clear(): void {
    this.map = null;
    this.rocks = null;
    this.playerIndex = null;
    this.entities.clear();
    this.projectiles.clear();
    this.groundItems.clear();
    this.cargo = emptyInventory();
    this.stats.clear();
    this.varps.clear();
    this.mapFlag = null;
  }
}
